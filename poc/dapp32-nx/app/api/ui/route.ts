import {Contract, JsonRpcProvider} from "ethers-v6";

import {FunctionABI} from "../../components/types";
import {prepareVariables} from "../../components/utils";


const getNextView = async (contractNetwork: string, contractAddress: string, functionABI: FunctionABI, functionArgs: Array<any>) => {
    // Development on Ganache only
    if (contractNetwork !== '0x539') {
        throw new Error(`Contract network ${contractNetwork} is not supported.`);
    }

    const ganacheProviderUrl = 'http://localhost:8545';

    // const contractABI: ethers.InterfaceAbi = require('../../../../on-chain/artifacts/contracts/AppUI.sol/AppUI.json').abi;
    const provider = new JsonRpcProvider(ganacheProviderUrl);

    const contract: Contract = new Contract(contractAddress, [functionABI], provider);

    console.debug(`Getting ${JSON.stringify(functionABI)} from contract ${contractAddress}`);

    const functionName = functionABI.name;

    console.debug(`Populating arguments ${JSON.stringify(functionABI.inputs)} of ${functionName} with:`, functionArgs);

    // Ask the blockchain
    const contractResponse =
        await contract[functionName](...functionArgs)
            .then(
                x => {
                    console.debug(`Got UI spec URI: ${x} of type ${typeof x}`);
                    return x;
                }
            )
            .catch(
                e => {
                    throw new Error(`Could not get UI URI from contract ${contractAddress}, calling ${functionName} with args ${functionArgs}; failed due to: ${e}.`);
                }
            );

    return contractResponse;
};


async function handlePostRequest(request: Request) {
    const data = await request.json();

    const contractNetwork = data.contractNetwork;
    const contractAddress = data.contractAddress;
    const functionABI: FunctionABI = data.functionABI;

    const functionArgs = prepareVariables(functionABI, data.variables);

    console.debug("functionArgs", functionArgs);

    const result = await getNextView(contractNetwork, contractAddress, functionABI, functionArgs);

    const outputs = functionABI.outputs;

    if (!outputs || !Array.isArray(outputs) || !outputs.length) {
        throw new Error(`Function ${functionABI.name} does not have any outputs.`);
    }

    if (outputs.length > 1) {
        if (!Array.isArray(result) || (result.length !== outputs.length)) {
            throw new Error(`Expected ${outputs.length} outputs based on the ABI.`);
        }

        const variables: { [key: string]: any } = outputs.reduce(
            (acc, output, index) => {
                (acc as any)[output.name] = result[index];
                return acc;
            },
            {}
        );

        return {
            ui: JSON.parse(await fetchURI(variables[""] || variables["ui"])),
            variables: {...variables, "": undefined, "ui": undefined},
        }
    } else {
        return {
            ui: JSON.parse(await fetchURI(result)),
            variables: {},
        }
    }
}

export async function POST(request: Request) {
    const jsonResult =
        await handlePostRequest(request).then(
            x => {
                return {ok: true, message: x};
            }
        ).catch(
            error => {
                console.error(`Error while handling POST request:`);
                console.error(" - Request - ", request);
                console.error(" - Error   - ", error);

                return {ok: false, message: `${error}`};
            }
        );

    return new Response(
        JSON.stringify(jsonResult),
        {
            headers: {"content-type": "application/json"},
        }
    );
}

export async function GET(request: Request) {
    return new Response(
        JSON.stringify({ok: true, method: "GET", message: await request.json()}),
        {
            headers: {"content-type": "application/json"},
        }
    );
}
