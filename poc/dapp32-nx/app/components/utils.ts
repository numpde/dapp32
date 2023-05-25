import {FunctionABI, VariablesOfUI} from "./types";
import {getAddress} from "ethers";


export const prepareVariables = (functionABI: FunctionABI, variables: VariablesOfUI) => {
    const functionArgs = functionABI.inputs.map(
        input => {
            if (input.type === 'address') {
                const addressString = variables[input.name];
                return getAddress(addressString);
            }

            return variables[input.name];
        }
    );

    return functionArgs;
}

export class ChronologicalMap<T> {
  private map: Map<number, T>;
  private counter: number;

  constructor() {
    this.map = new Map<number, T>();
    this.counter = 0;
  }

  add(object: T): number {
    const key = this.counter++;
    this.map.set(key, object);
    return key;
  }

  get(key: number): T | undefined {
    return this.map.get(key);
  }

  delete(key: number): boolean {
    return this.map.delete(key);
  }
}
