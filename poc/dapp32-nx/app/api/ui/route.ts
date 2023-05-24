import {ethers, getAddress} from 'ethers';
import {FunctionABI} from "../../components/types";

export async function POST(request: Request) {
    const data = await request.json();

    const contractNetwork = data.contractNetwork;
    const contractAddress = data.contractAddress;
    const contractFunctionABI: FunctionABI = data.functionABI;  // Contract function ABI

    const variables = data.variables;

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

    const contract: ethers.Contract = new ethers.Contract(contractAddress, [contractFunctionABI], provider);

    const getUISpec = async (contractAddress: string, contractFunction: FunctionABI) => {
        console.log(`Getting ${JSON.stringify(contractFunction)} from contract ${contractAddress}`);

        const functionName = contractFunction.name;

        console.debug(`Populating ${contractFunction.inputs} with ${JSON.stringify(variables)}`);

        const functionArgs = contractFunction.inputs.map(
            (input: any) => {
                if (input.type === 'address') {
                    const addressString = variables[input.name];
                    return getAddress(addressString);
                }

                return variables[input.name];
            }
        );

        console.log(`Calling ${functionName} with args ${JSON.stringify(functionArgs)}`);

        let uiSpecURI;

        try {
            if (functionArgs.length) {
                console.log(`Calling ${functionName} with 3 args`);
                uiSpecURI = await contract[functionName](...functionArgs);
            } else {
                console.log(`Calling ${functionName} with 0 args`);
                uiSpecURI = await contract[functionName]();
            }
        } catch (error) {
            console.error(error);
            throw new Error(`Could not get UI URI from contract ${contractAddress}, calling ${functionName} with args ${JSON.stringify(functionArgs)} failed.`);
        }

        if (!uiSpecURI) {
            throw new Error(`Could not get UI URI from contract ${contractAddress}`);
        }

        if (uiSpecURI.startsWith('http')) {
            return await (await fetch(uiSpecURI)).text();
        }

        return uiSpecURI;
    };

    const parseIfData = (uiSpec: string) => {
        if (uiSpec?.startsWith("data:")) {
            throw new Error("'data:' URI is not supported yet");
        }

        return uiSpec;
    };

    try {
        const uiSpec = JSON.parse(parseIfData(await getUISpec(contractAddress, contractFunctionABI)));

        return new Response(
            JSON.stringify({ok: true, uiSpec: uiSpec}),
            {
                headers: {"content-type": "application/json"},
            }
        );
    } catch (error) {
        console.error(error);

        return new Response(
            JSON.stringify({ok: false, message: `${error}`}),
            {
                headers: {"content-type": "application/json"},
            }
        );
    }
}

export async function GET(request: Request) {
    return new Response(
        JSON.stringify({ok: true, method: "GET", message: await request.json()}),
        {
            headers: {"content-type": "application/json"},
        }
    );
}
