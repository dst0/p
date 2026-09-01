type ArrayState = "commaOrEnd" | "firstValueOrEnd" | "value";
type ObjectState = "colon" | "commaOrEnd" | "firstKeyOrEnd" | "key" | "value";
type Container = { type: "array"; state: ArrayState } | { type: "object"; state: ObjectState };
type NumberState = "dot" | "exponent" | "exponentDigits" | "exponentSign" | "fraction" | "integer" | "sign" | "zero";

export interface StreamingJsonArrayValidator {
  append(character: string): void;
  readonly complete: boolean;
  readonly possible: boolean;
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\r" || character === "\n";
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

export function createStreamingJsonArrayValidator(): StreamingJsonArrayValidator {
  const stack: Container[] = [{ type: "array", state: "firstValueOrEnd" }];
  let complete = false;
  let possible = true;
  let stringKind: "key" | "value" | undefined;
  let escaped = false;
  let unicodeDigits = 0;
  let literalRemainder = "";
  let numberState: NumberState | undefined;

  const fail = (): void => {
    possible = false;
  };
  const finishValue = (): void => {
    const container = stack.at(-1);
    if (!container) {
      fail();
      return;
    }
    if (container.type === "array" && (container.state === "firstValueOrEnd" || container.state === "value")) {
      container.state = "commaOrEnd";
    } else if (container.type === "object" && container.state === "value") {
      container.state = "commaOrEnd";
    } else {
      fail();
    }
  };
  const closeContainer = (type: Container["type"]): void => {
    if (stack.at(-1)?.type !== type) {
      fail();
      return;
    }
    stack.pop();
    if (stack.length === 0) complete = true;
    else finishValue();
  };
  const startValue = (character: string): boolean => {
    if (character === '"') {
      stringKind = "value";
      return true;
    }
    if (character === "{") {
      stack.push({ type: "object", state: "firstKeyOrEnd" });
      return true;
    }
    if (character === "[") {
      stack.push({ type: "array", state: "firstValueOrEnd" });
      return true;
    }
    if (character === "t" || character === "f" || character === "n") {
      literalRemainder = character === "t" ? "rue" : character === "f" ? "alse" : "ull";
      return true;
    }
    if (character === "-") {
      numberState = "sign";
      return true;
    }
    if (character === "0") {
      numberState = "zero";
      return true;
    }
    if (character >= "1" && character <= "9") {
      numberState = "integer";
      return true;
    }
    return false;
  };

  const processOutsideToken = (character: string): void => {
    if (complete || !possible) {
      fail();
      return;
    }
    const container = stack.at(-1);
    if (!container) {
      fail();
      return;
    }
    if (isWhitespace(character)) return;
    if (container.type === "array") {
      if (container.state === "commaOrEnd") {
        if (character === ",") container.state = "value";
        else if (character === "]") closeContainer("array");
        else fail();
        return;
      }
      if (container.state === "firstValueOrEnd" && character === "]") {
        closeContainer("array");
        return;
      }
      if (!startValue(character)) fail();
      return;
    }
    if (container.state === "commaOrEnd") {
      if (character === ",") container.state = "key";
      else if (character === "}") closeContainer("object");
      else fail();
      return;
    }
    if (container.state === "firstKeyOrEnd" && character === "}") {
      closeContainer("object");
      return;
    }
    if (container.state === "firstKeyOrEnd" || container.state === "key") {
      if (character === '"') stringKind = "key";
      else fail();
      return;
    }
    if (container.state === "colon") {
      if (character === ":") container.state = "value";
      else fail();
      return;
    }
    if (!startValue(character)) fail();
  };

  const processNumber = (character: string): void => {
    if (!numberState) return;
    if (numberState === "sign") {
      numberState = character === "0" ? "zero" : character >= "1" && character <= "9" ? "integer" : undefined;
      if (!numberState) fail();
      return;
    }
    if (numberState === "zero" || numberState === "integer") {
      if (numberState === "integer" && isDigit(character)) return;
      if (character === ".") numberState = "dot";
      else if (character === "e" || character === "E") numberState = "exponent";
      else {
        numberState = undefined;
        finishValue();
        processOutsideToken(character);
      }
      return;
    }
    if (numberState === "dot") {
      if (isDigit(character)) numberState = "fraction";
      else fail();
      return;
    }
    if (numberState === "fraction") {
      if (isDigit(character)) return;
      if (character === "e" || character === "E") numberState = "exponent";
      else {
        numberState = undefined;
        finishValue();
        processOutsideToken(character);
      }
      return;
    }
    if (numberState === "exponent") {
      if (character === "+" || character === "-") numberState = "exponentSign";
      else if (isDigit(character)) numberState = "exponentDigits";
      else fail();
      return;
    }
    if (numberState === "exponentSign") {
      if (isDigit(character)) numberState = "exponentDigits";
      else fail();
      return;
    }
    if (isDigit(character)) return;
    numberState = undefined;
    finishValue();
    processOutsideToken(character);
  };

  return {
    append(character) {
      if (!possible) return;
      if (stringKind) {
        if (unicodeDigits > 0) {
          if (!/[0-9a-f]/iu.test(character)) fail();
          else if (--unicodeDigits === 0) escaped = false;
        } else if (escaped) {
          if (character === "u") unicodeDigits = 4;
          else if ('"\\/bfnrt'.includes(character)) escaped = false;
          else fail();
        } else if (character === "\\") escaped = true;
        else if (character === '"') {
          const closedKind = stringKind;
          stringKind = undefined;
          if (closedKind === "key") {
            const container = stack.at(-1);
            if (container?.type === "object") container.state = "colon";
            else fail();
          } else finishValue();
        } else if (character.charCodeAt(0) < 0x20) fail();
        return;
      }
      if (literalRemainder) {
        if (character !== literalRemainder[0]) fail();
        else {
          literalRemainder = literalRemainder.slice(1);
          if (!literalRemainder) finishValue();
        }
        return;
      }
      if (numberState) processNumber(character);
      else processOutsideToken(character);
    },
    get complete() {
      return possible && complete && !stringKind && !literalRemainder && !numberState;
    },
    get possible() {
      return possible;
    },
  };
}
