import React from 'react';

import {RelayProvider} from "@opengsn/provider";

import {
    BrowserProvider,
    Contract as ContractV6,
    ContractTransactionReceipt,
    ContractTransactionResponse, JsonRpcApiProvider
} from "ethers";

import {toast} from 'react-hot-toast';

import {ContractUIProps, ContractUIState, FunctionABI, VariablesOfUI} from "./types";
import {fetchJSON, isSameChain, MissingVariableError, prepareVariables} from "./utils";
import {DynamicUI} from "./DynamicUI";
import Web3ProviderContext from "./Web3ProviderContext";


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

            web3provider: props.web3provider,

            ui: undefined,

            getVariables: props.getVariables,
            onVariablesUpdate: props.onVariablesUpdate,

            scrollIntoViewRequest: props.scrollIntoViewRequest,

            executingCount: 0,

            walletRequestsPending: 0,

            error: undefined,
        };

        this.dispatchFunctionCall = this.dispatchFunctionCall.bind(this);
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
        this.state.onVariablesUpdate(newVariables);
    }

    componentDidMount() {
        this.fetchInitialUI()
            .then()
            .catch(
                (error) => {
                    toast.error(`Could not fetch initial view due to: ${error}`);
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
        const {contract} = await this.prepareExecutionReadOnly(ABIURI_FUNCTION_ABI);
        const contractABI = await contract[ABIURI_FUNCTION_ABI.name]();
        return await fetchJSON(contractABI);
    }

    getBrowserProvider(readOnly: boolean): JsonRpcApiProvider {
        if (readOnly) {
            if (!this.state.web3provider && !window.ethereum) {
                throw new Error("Could not connect to the default read-only network provider or to the wallet browser extension. Check the internet connection and that you have a wallet browser extension installed and activated.");
            }

            return this.state.web3provider || (new BrowserProvider(window.ethereum as any));
        }

        if (!window.ethereum) {
            throw new Error("Could not connect to the wallet browser extension. Is it installed and activated?");
        }

        return new BrowserProvider(window.ethereum as any);
    }

    prepareExecutionReadOnly = async (functionABI: FunctionABI) => {
        const provider = this.getBrowserProvider(true);
        // const signer = await provider.getSigner();
        const contract = new ContractV6(this.state.contract.address, [functionABI], provider);

        if (!isSameChain((await provider.getNetwork()).chainId, this.state.contract.network)) {
            throw new Error(`Network mismatch...`);
        }

        return {contract, provider};
    }

    prepareExecutionWithUserSignature = async (functionABI: FunctionABI) => {
        const provider = this.getBrowserProvider(false);
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
                    provider: this.getBrowserProvider(false) as any,
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
                        console.debug(`Transaction sent: ${transactionResponse}. Waiting for receipt...`);
                        return transactionResponse.wait();
                    })
                    .catch((error: any) => {
                        throw error;
                    });

            if (!txReceipt) {
                throw new Error("No transaction receipt received.");
            }

            return txReceipt;
        } finally {
            this.setState(state => ({...state, walletRequestsPending: state.walletRequestsPending - 1}));
        }
    };

    executeOffChain = async (contract: ContractV6, functionABI: FunctionABI, functionArgs: any[]) => {
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

        // We receive typed values from the contract and convert them to strings for display.
        const parseType = (x: any, type: string): string => {
            return `${x}`;
        }

        const variables: { [key: string]: any; } = outputs.reduce(
            (acc: object, output: any, index: number) => {
                (acc as any)[output.name || ""] = parseType(contractResponse[index], output.type);
                return acc;
            },
            {}
        );

        console.log("ContractUI.executeOffChain: variables:", variables);

        const dropEmptyKeys = (object: any) => {
            return Object.entries({...object}).reduce((object: any, [key, value]) => {
                if (key) {
                    object[key] = value;
                }
                return object;
            }, {});
        }

        return {
            ui: await fetchJSON(variables[""] || variables["ui"]),
            variables: dropEmptyKeys(variables) as VariablesOfUI,
        };
    };

    //
    // THIS FUNCTION IS TOO COMPLICATED. REFACTOR IT.
    //
    dispatchFunctionCall = async (eventDefinition: any, functionSelector: string, contractABI: any) => {
        console.debug("ContractUI.dispatchFunctionCall:", functionSelector, "of", eventDefinition);

        // Todo: allow a relative path to the new JSON instead of a function call to the contract

        contractABI = contractABI || this.state.contractABI;

        const nameOfFunction = eventDefinition[functionSelector];

        const functionABI = contractABI.find((abi: FunctionABI) => (abi.name === nameOfFunction));

        if (!functionABI) {
            console.error(`Function ABI ${nameOfFunction} not found for event in the contract ABI.`, contractABI);
            throw new Error(`Function ABI for '${nameOfFunction}' not found for event in the contract ABI.`);
        }

        if (!(["nonpayable", "payable", "view", "pure"].includes(functionABI.stateMutability))) {
            throw new Error(`Contract function ABI has invalid state mutability '${functionABI.stateMutability}'`);
        }

        const functionArgs = prepareVariables(functionABI, this.state.getVariables());

        // Does it require no user signature to proceed?
        if (["view", "pure"].includes(functionABI.stateMutability)) {
            const {contract} = await this.prepareExecutionReadOnly(functionABI);

            const response = await this.executeOffChain(contract, functionABI, functionArgs);

            console.debug("ContractUI.dispatchFunctionCall: response:", response);

            this.setState(state => ({...state, ui: response.ui}));
            this.onVariablesUpdate(response.variables);

            return;
        }

        if (functionABI.stateMutability === "payable") {
            throw new Error(`Contract function ABI is 'payable', which is not implemented yet.`);
        }

        const {contract, provider} =
            eventDefinition?.gasless ?
                await this.prepareExecutionViaRelay(functionABI) :
                await this.prepareExecutionWithUserSignature(functionABI);

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


        try {
            await this.dispatchFunctionCall(eventDefinition, FUNCTION_SELECTOR_DEFAULT, this.state.contractABI)
                .then(this.props.scrollIntoViewRequest)
        } catch (error) {
            if (error instanceof MissingVariableError) {
                if (error.variableName == "userAddress") {
                    toast.error(
                        `Missing variable '${error.variableName}'. ` +
                        `This indicates that you should connect to a wallet browser extension.`,
                    );
                } else {
                    toast.error(
                        `Missing variable '${error.variableName}'. ` +
                        `This indicates a bug in the contract.`,
                    );
                }
            } else if (error instanceof Error) {
                toast.error(error.message);
            } else {
                toast.error(`Unknown error: ${error}`);
            }

        }

        this.setState(state => ({...state, executingCount: state.executingCount - 1}));
    };

    render = () => {
        if (!this.isReady()) {
            return;
        }

        return (
            <div ref={this.mainDiv} className="ContractUI">
                <div className={this.state.executingCount > 0 ? 'with-overlay' : 'no-overlay'}>
                    {
                        this.state.ui
                        &&
                        <Web3ProviderContext.Provider value={this.state.web3provider}>
                            <DynamicUI
                                ui={this.state.ui}
                                onEvent={this.onEvent}
                                getVariables={this.state.getVariables}
                                onVariablesUpdate={this.onVariablesUpdate}
                            />
                        </Web3ProviderContext.Provider>
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
