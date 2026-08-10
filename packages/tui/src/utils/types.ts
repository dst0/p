export type Osc8Terminator = "\x07" | "\x1b\\";

export interface ActiveHyperlink {
  params: string;
  url: string;
  terminator: Osc8Terminator;
}
