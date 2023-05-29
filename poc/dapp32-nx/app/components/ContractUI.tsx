import React from 'react';

import {RelayProvider} from "@opengsn/provider";
import {
    BrowserProvider,
    Contract as ContractV6,
    ContractTransactionReceipt,
    ContractTransactionResponse,
    parseEther
} from "ethers-v6";

import {ContractUIProps, ContractUIState, FunctionABI, VariablesOfUI} from "./types";
import {prepareVariables} from "./utils";
import {DynamicUI} from "./DynamicUI";


const INITIAL_VIEW_FUNCTION_ABI: FunctionABI = {
    "inputs": [
        {
            "name": "userAddress",
            "type": "address"
        }
    ],
    "name": "viewEntryD",
    "outputs": [
        {
            "name": "ui",
            "type": "string"
        },
        {
            "name": "blankTokenId",
            "type": "uint256"
        },
        {
            "name": "tokenCount",
            "type": "uint256"
        }
    ],
    "stateMutability": "view",
    "type": "function"
};

const FUNCTION_SELECTOR_DEFAULT: string = "default";
const FUNCTION_SELECTOR_SUCCESS: string = "success";
const FUNCTION_SELECTOR_FAILURE: string = "failure";


export class ContractUI extends React.Component<ContractUIProps, ContractUIState> {
    constructor(props: ContractUIProps) {
        super(props);

        props.walletState;  // unused

        this.state = {
            contract: props.contract,

            ui: undefined,

            variables: props.variables,
            onVariablesUpdate: props.onVariablesUpdate,

            executingCount: 0,

            walletRequestsPending: 0,
        };
    }

    isReady = () => {
        return this.state.contract.network && this.state.contract.address;
    }

    // getContractFunctionABI = (method) => {
    //     return this.state.contractABI.find((abi) => abi.name === method);
    // }

    onVariablesUpdate = (newVariables: VariablesOfUI) => {
        console.debug("ContractUI.onVariablesUpdate:", newVariables);
        this.setState((state) => ({...state, variables: {...state.variables, ...newVariables}}));
        this.state.onVariablesUpdate(newVariables);
    }

    componentDidMount() {
        const initialFunctionABI = {
            ...INITIAL_VIEW_FUNCTION_ABI,
            name: this.state.contract.view,
        };

        this.queryNextView(initialFunctionABI, this.state.variables).then(
            //
        ).catch(
            console.error
        );
    }

    // Queries the backend, hence does not require MetaMask
    queryNextView = async (functionABI: FunctionABI, variables: VariablesOfUI) => {
        if (!functionABI) {
            throw new Error("No functionABI available.");
        }

        console.debug("Retrieving UI spec for", functionABI, variables);

        const response = await fetch("/api/ui",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    contractNetwork: this.state.contract.network,
                    contractAddress: this.state.contract.address,

                    functionABI,
                    variables,
                }),
            },
        ).then(
            r => r.json()
        ).catch(
            (e) => {
                throw new Error(`Error while fetching the UI spec (${e}).`)
            }
        )

        if (!response?.ok) {
            throw new Error(`Couldn't parse the response from the backend: ${JSON.stringify(response)}`);
        }

        console.debug("Got response from the backend:", response);

        this.setState(
            state => ({
                    ...state,
                    ui: response.message.ui,
                    variables: {...state.variables, ...response.message.variables}
            })
        );
    };

    prepareExecutionWithSignature = async (functionABI: FunctionABI) => {
        const provider = new BrowserProvider(window.ethereum as any);
        const signer = await provider.getSigner();
        const contract = new ContractV6(this.state.contract.address, [functionABI], signer);

        return {contract: contract, signer: signer, provider: provider};
    };

    prepareExecutionViaRelay = async (functionABI: FunctionABI) => {
        // readJsonFile("../../../opengsn-local/build/gsn/Paymaster.json").address;
        const paymasterAddress = "0x2FE70142C2F757cc4AB910AA468CFD541399982f";

        const {gsnProvider, gsnSigner} =
            await RelayProvider.newEthersV6Provider(
                {
                    provider: (new BrowserProvider(window.ethereum as any)) as any,
                    config: {
                        paymasterAddress,
                        performDryRunViewRelayCall: true,
                        loggerConfiguration: {logLevel: 'debug'},
                    }
                }
            );

        const contract = new ContractV6(this.state.contract.address, [functionABI], gsnSigner);

        return {contract: contract, signer: gsnSigner, provider: gsnProvider};
    };


    executeOnChain = async (contract: ContractV6, functionName: string, functionArgs: any[]): Promise<ContractTransactionReceipt> => {
        const This = this.constructor.name;

        try {
            this.setState(state => ({...state, walletRequestsPending: state.walletRequestsPending + 1}));

            const txReceipt =
                await contract[functionName](...functionArgs)
                    .then((transactionResponse: ContractTransactionResponse) => {
                        console.debug(`${This} transaction sent: ${transactionResponse}. Waiting for receipt...`);
                        return transactionResponse.wait();
                    })
                    .catch((error: any) => {
                        throw new Error(`${This} error: ${error}`)
                    });

            if (!txReceipt) {
                throw new Error(`${This} error: no transaction receipt.`);
            }

            return txReceipt;
        } finally {
            this.setState(state => ({...state, walletRequestsPending: state.walletRequestsPending - 1}));
        }
    }

    //
    // THIS FUNCTION IS TOO COMPLICATED. REFACTOR IT.
    //
    dispatchFunctionCall = async (eventDefinition: any, nameOfFunction: string) => {
        const functionABI = eventDefinition?.[nameOfFunction];

        if (!functionABI) {
            throw new Error(`${typeof this}: Function ABI .${nameOfFunction} not found for event in ${JSON.stringify(eventDefinition)}`);
        }

        // Does it require no user signature to proceed?
        if (["view", "pure"].includes(functionABI.stateMutability)) {
            await this.queryNextView(functionABI, this.state.variables)
                .then(console.debug)
                .catch(console.error);

            return;
        }

        if (!(["nonpayable", "payable"].includes(functionABI.stateMutability))) {
            throw new Error(`${typeof this}: Contract function ABI has invalid state mutability '${functionABI.stateMutability}'`);
        }

        if (functionABI.stateMutability === "payable") {
            throw new Error(`${typeof this}: Contract function ABI is 'payable', which is not implemented yet.`);
        }

        const functionArgs = prepareVariables(functionABI, this.state.variables);

        const {contract, signer, provider} =
            eventDefinition?.gasless ?
                await this.prepareExecutionViaRelay(functionABI) :
                await this.prepareExecutionWithSignature(functionABI);

        // Check sanity
        {
            // Chain ID
            {
                const contractChainId = BigInt(parseInt(this.state.contract.network, 16));
                const userChainId = BigInt((await provider.getNetwork()).chainId);

                if (contractChainId !== userChainId) {
                    throw new Error(`Contract chain ID (${contractChainId}) does not match user chain ID (${userChainId}).`);
                }
            }
        }

        // This block involves signing and sending transactions.
        {
            try {
                // const balanceBefore = await provider.getBalance(signer.getAddress());

                const txReceipt = await this.executeOnChain(contract, functionABI.name, functionArgs);
                console.debug(`Transaction success: ${txReceipt}`);

                // console.debug("Balance before:", balanceBefore);
                // console.debug("Balance after:", await provider.getBalance(signer.getAddress()));

                // Proceed with the `success` branch
                await this.dispatchFunctionCall(eventDefinition, FUNCTION_SELECTOR_SUCCESS);
            } catch (error) {
                console.error(`Transaction failed or rejected: ${error}`);

                // Proceed with the `failure` branch
                await this.dispatchFunctionCall(eventDefinition, FUNCTION_SELECTOR_FAILURE);
            }
        }
    };

    // Notably, this handles the Submit button
    onEvent = async (name: string, eventDefinition: any, element: any) => {
        console.debug(name, eventDefinition, "from", element);

        if (name !== "onClick") {
            console.warn("Unhandled event:", name);
            return;
        }

        this.setState(state => ({...state, executingCount: state.executingCount + 1}));

        await this.dispatchFunctionCall(eventDefinition, FUNCTION_SELECTOR_DEFAULT)
            .catch(
                console.error
            );

        this.setState(state => ({...state, executingCount: state.executingCount - 1}));
    };

    render = () => {
        if (!this.isReady()) {
            return;
        }

        return (
            <div>
                <div className={this.state.executingCount > 0 ? 'with-overlay' : 'no-overlay'}>
                    {
                        this.state.ui
                        &&
                        <DynamicUI
                            ui={this.state.ui}
                            onEvent={this.onEvent}
                            variables={this.state.variables}
                            onVariablesUpdate={this.onVariablesUpdate}
                        />
                        ||
                        <div>Loading the UI...</div>
                    }
                </div>
                <div>
                    {
                        this.state.walletRequestsPending
                            ?
                            <div className="wallet-requests-pending">
                                Wallet requests pending: {this.state.walletRequestsPending}
                            </div>
                            :
                            <></>
                    }
                </div>
            </div>
        );
    }
}
