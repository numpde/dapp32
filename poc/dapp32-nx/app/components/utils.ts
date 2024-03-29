import {getAddress, JsonRpcApiProvider} from "ethers";
import {Contract as ContractV6} from "ethers-v6";

import {FunctionABI, NetworkInfo, VariablesOfUI} from "./types";
import networkInfos from "../../chainlist/networks.json";

// https://docs.soliditylang.org/en/latest/grammar.html#a4.SolidityLexer.Identifier
export const solidityFunctionNameRegex = /^[a-zA-Z$_][a-zA-Z0-9$_]*$/;


export class MissingVariableError extends Error {
    public variableName: string;

    constructor(variableName: string, message?: string) {
        super(message);

        this.name = "MissingVariableError";
        this.variableName = variableName;
    }
}

export const prepareVariables = (functionABI: FunctionABI, variables: VariablesOfUI) => {
    const functionArgs = functionABI.inputs.map(
        input => {
            const value = variables[input.name];

            if (value == undefined) {
                throw new MissingVariableError(input.name, `Missing value for input '${input.name}'.`);
            }

            if (input.type === 'address') {
                return getAddress(value);
            }

            if (input.type === 'uint256') {
                return BigInt(value);
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

export function getNetworkInfo(chainId: number | string | bigint): (NetworkInfo | undefined) {
    return networkInfos.find(
        (networkInfo: any) => (BigInt(networkInfo.chainId) == BigInt(chainId))
    );
}

export function humanizeChain(chainId: number | string | bigint | undefined): string {
    if (!chainId) {
        return 'Unknown';
    }

    const networkInfo = getNetworkInfo(chainId);

    if (networkInfo) {
        return `${networkInfo.name} (${chainId})`;
    } else {
        return `Chain ID ${chainId}`;
    }
}

// export async function safeLoadJson(path: string): Promise<any | undefined> {
//     try {
//         const readFileAsync = promisify(fs.readFile);
//         const data = await readFileAsync(path, 'utf8');
//         return JSON.parse(data);
//     } catch (err: any) {
//         if (err.code === 'ENOENT') {
//             console.debug(`safeLoadJson: No file found at ${path}`);
//             return undefined;
//         }
//         throw err;
//     }
// }


export async function getPaymastersBalance(provider: JsonRpcApiProvider, paymasterChainId: string, paymasterAddress: string) {
    if (!isSameChain((await provider.getNetwork()).chainId, paymasterChainId)) {
        throw new Error(`Provider chain ID and paymaster chain ID mismatch.`);
    }

    const pmAbi = [
        {
            "inputs": [],
            "name": "getRelayHub",
            "outputs": [
                {
                    "name": "",
                    "type": "address"
                }
            ],
            "stateMutability": "view",
            "type": "function"
        }
    ];

    const paymasterContract = new ContractV6(paymasterAddress, pmAbi, provider as any);

    const relayHubAddress = await paymasterContract.getRelayHub();

    const rhAbi = [
        {
            "inputs": [
                {
                    "name": "target",
                    "type": "address"
                }
            ],
            "name": "balanceOf",
            "outputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "stateMutability": "view",
            "type": "function"
        }
    ];

    const relayHubContract = new ContractV6(relayHubAddress, rhAbi, provider as any);

    return await relayHubContract.balanceOf(paymasterAddress);
}
