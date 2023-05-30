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
import {fetchJSON, isSameChain, prepareVariables} from "./utils";
import {DynamicUI} from "./DynamicUI";
import values from "ajv/lib/vocabularies/jtd/values";
import {setState} from "jest-circus";


const FUNCTION_SELECTOR_DEFAULT: string = "default";
const FUNCTION_SELECTOR_SUCCESS: string = "success";
const FUNCTION_SELECTOR_FAILURE: string = "failure";

const ABIURI_FUNCTION_ABI: FunctionABI = {
    name: "abiURI",
    inputs: [],
    outputs: [
        {
            name: "abi",
            type: "string",
        }
    ],
    stateMutability: "pure",
    type: "function",
};


export class ContractUI extends React.Component<ContractUIProps, ContractUIState> {
    mainDiv = React.createRef<HTMLDivElement>();

    constructor(props: ContractUIProps) {
        super(props);

        props.walletState;  // unused

        this.state = {
            contract: props.contract,
            contractABI: undefined,

            ui: undefined,

            variables: props.variables,
            onVariablesUpdate: props.onVariablesUpdate,

            scrollIntoViewRequest: props.scrollIntoViewRequest,

            executingCount: 0,

            walletRequestsPending: 0,

            error: undefined,
        };
    }

    // componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    //     console.error(error, errorInfo);
    // }

    componentDidUpdate() {
        if (this.state.error) {
            this.setState(state => ({...state, error: undefined}));
            throw this.state.error;
        }
    }

    isReady = () => {
        return this.state.contract.network && this.state.contract.address;
    }

    // getContractFunctionABI = (method) => {
    //     return this.state.contractABI.find((abi) => abi.name === method);
    // }

    onVariablesUpdate = (newVariables: VariablesOfUI) => {
        console.debug("ContractUI.onVariablesUpdate:", newVariables);
        this.setState((state) => {
            const newState = {...state, variables: {...state.variables, ...newVariables}};
            state.onVariablesUpdate(newState.variables);
            return newState;
        });
    }

    componentDidMount() {
        this.fetchInitialUI()
            .then()
            .catch(
                (error) => {
                    this.setState(state => ({...state, error}))
                }
            );
    }

    fetchInitialUI = async () => {
        const contractABI = await this.getContractABI();
        this.setState(state => ({...state, contractABI}));

        // const initialABI = contractABI.find((abi: any) => (abi.name === this.state.contract.view));

        await this.dispatchFunctionCall({[FUNCTION_SELECTOR_DEFAULT]: this.state.contract.view}, FUNCTION_SELECTOR_DEFAULT, contractABI);
    };


    getContractABI = async () => {
        const {contract} = await this.prepareExecutionWithSignature(ABIURI_FUNCTION_ABI);
        const contractABI = await contract[ABIURI_FUNCTION_ABI.name]();
        return await fetchJSON(contractABI);
    }

    prepareExecutionWithSignature = async (functionABI: FunctionABI) => {
        const provider = new BrowserProvider(window.ethereum as any);
        const signer = await provider.getSigner();
        const contract = new ContractV6(this.state.contract.address, [functionABI], signer);

        if (!isSameChain((await provider.getNetwork()).chainId, this.state.contract.network)) {
            throw new Error(`Network mismatch...`);
        }

        return {contract, signer, provider};
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

        if (!isSameChain((await gsnProvider.getNetwork()).chainId, this.state.contract.network)) {
            throw new Error(`Network mismatch...`);
        }

        return {contract: contract, signer: gsnSigner, provider: gsnProvider};
    };

    executeOnChain = async (contract: ContractV6, functionName: string, functionArgs: any[]): Promise<ContractTransactionReceipt> => {
        const This = this.constructor.name;

        try {
            this.setState(state => ({...state, walletRequestsPending: state.walletRequestsPending + 1}));

            console.log(
                "Call function:", functionName,
                "with arguments", functionArgs,
                "on contract at", await contract.getAddress(),
            );

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
    };

    executeOffChain = async (contract: ContractV6, functionABI: FunctionABI, functionArgs: any[]) => {
        const This = this.constructor.name;

        const contractResponse =
            await contract[functionABI.name](...functionArgs)
                .then(
                    x => {
                        console.debug(`Got UI spec URI: ${x} of type ${typeof x}`);
                        return x;
                    }
                )
                .catch(
                    e => {
                        throw new Error(`Could not get UI URI from contract, calling ${functionABI.name} with args ${functionArgs} due to: ${e}.`);
                    }
                );

        const outputs = functionABI.outputs;

        if (!outputs?.length) {
            throw new Error(`No 'outputs' in the ABI for function '${functionABI.name}'.`);
        }

        if (outputs.length == 1) {
            return {
                ui: await fetchJSON(contractResponse),
                variables: {} as VariablesOfUI,
            }
        }

        if (!Array.isArray(contractResponse) || (contractResponse.length !== outputs.length)) {
            throw new Error(`Expected ${outputs.length} outputs based on the ABI.`);
        }

        const variables: { [key: string]: any; } = outputs.reduce(
            (acc: object, output: any, index: number) => {
                (acc as any)[output.name || ""] = contractResponse[index];
                return acc;
            },
            {}
        );

        console.log("ContractUI.executeOffChain: variables:", variables);

        return {
            ui: await fetchJSON(variables[""] || variables["ui"]),
            variables: Object.entries({...variables}).reduce((object: any, [key, value]) => {
                if (key) {
                    object[key] = value;
                }
                return object;
            }, {}) as VariablesOfUI,
        };
    };

    //
    // THIS FUNCTION IS TOO COMPLICATED. REFACTOR IT.
    //
    dispatchFunctionCall = async (eventDefinition: any, functionSelector: string, contractABI: any) => {
        console.debug("ContractUI.dispatchFunctionCall:", functionSelector, "of", eventDefinition);

        contractABI = contractABI || this.state.contractABI;

        const nameOfFunction = eventDefinition[functionSelector];

        const functionABI = contractABI.find((abi: any) => (abi.name === nameOfFunction));

        if (!functionABI) {
            throw new Error(`${typeof this}: Function ABI ${nameOfFunction} not found for event in ${JSON.stringify(contractABI)}`);
        }

        if (!(["nonpayable", "payable", "view", "pure"].includes(functionABI.stateMutability))) {
            throw new Error(`${typeof this}: Contract function ABI has invalid state mutability '${functionABI.stateMutability}'`);
        }

        const functionArgs = prepareVariables(functionABI, this.state.variables);

        // Does it require no user signature to proceed?
        if (["view", "pure"].includes(functionABI.stateMutability)) {
            const {contract, signer, provider} = await this.prepareExecutionWithSignature(functionABI);

            const response = await this.executeOffChain(contract, functionABI, functionArgs);

            console.debug("ContractUI.dispatchFunctionCall: response:", response);

            this.setState(state => ({...state, ui: response.ui}));
            this.onVariablesUpdate(response.variables);

            return;
        }

        if (functionABI.stateMutability === "payable") {
            throw new Error(`${typeof this}: Contract function ABI is 'payable', which is not implemented yet.`);
        }
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
                await this.dispatchFunctionCall(eventDefinition, FUNCTION_SELECTOR_SUCCESS, contractABI);
            } catch (error) {
                console.error(`Transaction failed or rejected: ${error}`);

                // Proceed with the `failure` branch
                await this.dispatchFunctionCall(eventDefinition, FUNCTION_SELECTOR_FAILURE, contractABI);
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

        await this.dispatchFunctionCall(eventDefinition, FUNCTION_SELECTOR_DEFAULT, this.state.contractABI)
            .then(
                () => {
                    this.props.scrollIntoViewRequest();
                }
            )
            .catch(console.error);

        this.setState(state => ({...state, executingCount: state.executingCount - 1}));
    };

    render = () => {
        if (!this.isReady()) {
            return;
        }

        return (
            <div ref={this.mainDiv}>
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
};
