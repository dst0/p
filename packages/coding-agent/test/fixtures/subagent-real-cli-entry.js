import { fauxAssistantMessage, registerFauxProvider } from "@dst0/p-ai";
import { main } from "../../src/main.ts";

const registration = registerFauxProvider({
  api: "subagent-faux-api",
  provider: "subagent-faux",
  models: [{ id: "inherited-model", name: "Inherited model", reasoning: true }],
  preserveOnReset: true,
});
const model = registration.getModel();
registration.setResponses([
  (_context, options, _state, requestModel) => {
    const observed = JSON.stringify({
      provider: requestModel.provider,
      model: requestModel.id,
      reasoning: options?.reasoning,
    });
    return fauxAssistantMessage(observed);
  },
]);

await main(
  ["--no-extensions", "--task-verification", "off", "--completion-mode", "implicit", ...process.argv.slice(2)],
  {
    extensionFactories: [
      (p) => {
        p.registerProvider(model.provider, {
          api: model.api,
          apiKey: "fixture-key",
          baseUrl: model.baseUrl,
          models: [
            {
              id: model.id,
              name: model.name,
              reasoning: model.reasoning,
              input: model.input,
              cost: model.cost,
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
            },
          ],
        });
      },
    ],
  },
);
