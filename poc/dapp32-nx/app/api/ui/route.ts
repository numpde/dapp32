import Web3 from 'web3';


export async function POST(request: Request) {

    const data = await request.json();


    const contractNetwork = data.contractNetwork;
    const contractAddress = data.contractAddress;
    const method = data.method;

    const contractABI = require('../../../../on-chain/artifacts/contracts/AppUI.sol/AppUI.json').abi;

    const ganacheProviderUrl = 'http://localhost:8545';
    const web3 = new Web3(ganacheProviderUrl);

    const contract = new web3.eth.Contract(contractABI, contractAddress);

    const getViewSpec = async (contractAddress: string, method: string) => {
        console.log(`Getting ${method} from contract ${contractAddress}`);

        const viewSpecURI = await contract.methods[method]().call(
            (error, result) => {
                if (error) {
                    console.error(error);
                    return undefined;
                } else {
                    return result;
                }
            }
        );

        if (!viewSpecURI) {
            return new Response(
                JSON.stringify({
                    ok: false,
                    message: `Could not get viewSpecURI from contract ${contractAddress}`
                }),
            )
        }

        if (viewSpecURI.startsWith('http')) {
            return await (await fetch(viewSpecURI)).text();
        }

        return viewSpecURI;
    };

    const parseIfData = (viewSpec: string) => {
        if (viewSpec.startsWith("data:")) {
            throw new Error("'data:' URI is not supported yet");
        }

        return viewSpec;
    };

    const viewSpec = JSON.parse(parseIfData(await getViewSpec(contractAddress, method)));

    return new Response(
        JSON.stringify({ok: true, viewSpec: viewSpec}),
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
