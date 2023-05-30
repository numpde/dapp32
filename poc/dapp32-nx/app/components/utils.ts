import {getAddress} from "ethers-v6";

import {FunctionABI, VariablesOfUI} from "./types";
import {BigNumber} from "ethers";


export const prepareVariables = (functionABI: FunctionABI, variables: VariablesOfUI) => {
    const functionArgs = functionABI.inputs.map(
        input => {
            if (input.type === 'address') {
                return getAddress(variables[input.name]);
            }

            if (input.type === 'uint256') {
                return BigInt(variables[input.name]);
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

export const fetchJSON = async (ui: any) => {
    if (typeof ui === 'string') {
        if (ui.startsWith('http')) {
            return await
                fetch(ui, {
                    method: 'GET', // or 'POST'
                    cache: 'no-store', // *default, no-store, reload, no-cache, force-cache, only-if-cached
                })
                    .then(x => x.json());
        } else {
            return JSON.parse(ui);
        }
    }

    throw new Error(`URI received is not a string: ${ui}.`);
};

export function isSameChain(chainId1: number | string | bigint, chainId2: number | string | bigint): boolean {
    const bigChainId1 = BigInt(chainId1);
    const bigChainId2 = BigInt(chainId2);

    return bigChainId1 == bigChainId2;
}
