import React from 'react';

import {DynamicUI} from "./DynamicUI";
import {ContractUIProps, ContractUIState, FunctionABI, VariablesOfUI} from "./types";
import {ChronologicalMap, prepareVariables} from "./utils";
import {ContractTransactionReceipt, ContractTransactionResponse, ethers} from "ethers";


const INITIAL_VIEW_FUNCTION_ABI: FunctionABI = {
    name: "getInitialView",
    inputs: [],
    outputs: [{name: "uiSpec", type: "string"}],
    stateMutability: "view",
    type: "function",
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

        this.setState(state => ({...state, ui: response.message}));
    };

    executeWithSignature = async (functionABI: FunctionABI, variables: VariablesOfUI): Promise<ContractTransactionReceipt> => {
        const provider = new ethers.BrowserProvider(window.ethereum as any);
        const signer = await provider.getSigner();
        const contract = new ethers.Contract(this.state.contract.address, [functionABI], signer);

        const functionArgs = prepareVariables(functionABI, variables);

        // // Get the current nonce
        // const nonce = await provider.getTransactionCount(signer.getAddress());

        // // Set the gas limit
        // const gasLimit = ethers.utils.hexlify(21000); // This is just an example value

        // // Get the current gas prices and chain ID
        // const gasPriceData = await provider.getFeeData();
        // const maxFeePerGas = gasPriceData.maxFeePerGas;
        // const maxPriorityFeePerGas = gasPriceData.maxPriorityFeePerGas;
        // const chainId = /* this should be the target contract chain */;

        // Value to be sent with the transaction
        const value = ethers.parseEther("0.001");

        // Transaction data
        console.debug(`Sending transaction to ${this.state.contract.address} with data: ${functionABI.name}(*${functionArgs}).`);
        // const data = contract.interface.encodeFunctionData(functionABI.name, functionArgs);
        //
        // // contract.populateTransaction[functionABI.name](...functionArgs).then(
        //
        // const transaction = {
        //     // from: signer.getAddress(),
        //     // chainId: parseInt(this.state.contract.network, 16),
        //     to: this.state.contract.address,
        //
        //     // nonce,
        //     value,
        //     data,
        //     // maxFeePerGas,
        //     // maxPriorityFeePerGas,
        //     // gasLimit
        // };
        //
        // const txSigned = await signer.signTransaction(transaction);

        const This = this.constructor.name;


        try {
            this.setState(state => ({...state, walletRequestsPending: state.walletRequestsPending + 1}));

            const txReceipt =
                await contract[functionABI.name](...functionArgs, {value: 0})
                    .then((transactionResponse: ContractTransactionResponse) => {
                        console.debug(`${This} transaction sent: ${transactionResponse}. Waiting for receipt...`);
                        return transactionResponse.wait();
                    })
                    .catch((error) => {
                        throw new Error(`${This} error: ${error}`)
                    });

            if (!txReceipt) {
                throw new Error(`${This} error: no transaction receipt.`);
            }

            return txReceipt;
        } finally {
            this.setState(state => ({...state, walletRequestsPending: state.walletRequestsPending - 1}));
        }
    };

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

        try {
            const txReceipt = await this.executeWithSignature(functionABI, this.state.variables);

            console.debug(`Transaction success: ${txReceipt}`);

            // Proceed with the `success` branch
            await this.dispatchFunctionCall(eventDefinition, FUNCTION_SELECTOR_SUCCESS);
        } catch (error) {
            console.error(`Transaction failure: ${error}`);

            // Proceed with the `failure` branch
            await this.dispatchFunctionCall(eventDefinition, FUNCTION_SELECTOR_FAILURE);
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
