import {ethers} from 'ethers';
import {FunctionABI} from "../../components/types";
import {prepareVariables} from "../../components/utils";


const getUISpec = async (contractNetwork: string, contractAddress: string, functionABI: FunctionABI, functionArgs: Array<any>) => {
    // Development on Ganache only
    if (contractNetwork !== '0x539') {
        return new Response(
            JSON.stringify({
                ok: false,
                message: `Contract network ${contractNetwork} is not supported.`
            }),
        )
    }

    const ganacheProviderUrl = 'http://localhost:8545';

    // const contractABI: ethers.InterfaceAbi = require('../../../../on-chain/artifacts/contracts/AppUI.sol/AppUI.json').abi;
    const provider = new ethers.JsonRpcProvider(ganacheProviderUrl);

    const contract: ethers.Contract = new ethers.Contract(contractAddress, [functionABI], provider);


    console.debug(`Getting ${JSON.stringify(functionABI)} from contract ${contractAddress}`);

    const functionName = functionABI.name;

    console.debug(`Populating ${JSON.stringify(functionABI.inputs)} with ${JSON.stringify(functionArgs)}`);


    console.debug(`Calling ${functionName} with args ${JSON.stringify(functionArgs)}`);

    // Ask the blockchain
    const uiSpecURI =
        await (
            !functionArgs ?
                contract[functionName]() :
                contract[functionName](...functionArgs)
        )
            .then(
                x => {
                    console.debug(`Got UI spec URI: ${x} of type ${typeof x}`);
                    return x;
                }
            )
            .catch(
                e => {
                    throw new Error(`Could not get UI URI from contract ${contractAddress}, calling ${functionName} with args ${JSON.stringify(functionArgs)} failed due to: ${e}.`);
                }
            );

    if (typeof uiSpecURI === 'string') {
        if (uiSpecURI.startsWith('http')) {
            console.debug(`Getting UI spec from "${uiSpecURI}".`);
            return await (await fetch(uiSpecURI)).text();
        }
    }

    return uiSpecURI;
};

const parseIfData = (uiSpec: string) => {
    if (typeof uiSpec === 'string') {
        if (uiSpec.startsWith("data:")) {
            throw new Error(`URI is not supported yet: ${uiSpec}`);
        }
    } else {
        throw new Error(`UI spec received from contract is not a string (${uiSpec}).`);
    }

    return uiSpec;
};


async function handlePostRequest(request: Request) {
    const data = await request.json();

    const contractNetwork = data.contractNetwork;
    const contractAddress = data.contractAddress;
    const functionABI: FunctionABI = data.functionABI;

    const functionArgs = prepareVariables(functionABI, data.variables);

    const uiSpec = JSON.parse(parseIfData(await getUISpec(contractNetwork, contractAddress, functionABI, functionArgs)));

    return uiSpec;
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
