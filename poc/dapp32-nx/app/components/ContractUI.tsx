import React from 'react';

import {RelayProvider} from "@opengsn/provider";

import {
    BrowserProvider,
    Contract as ContractV6,
    ContractTransactionReceipt,
    ContractTransactionResponse, ethers, getAddress, JsonRpcApiProvider, Provider
} from "ethers";

import {toast} from 'react-hot-toast';

import {ContractUIProps, ContractUIState, FunctionABI, VariablesOfUI} from "./types";
import {
    fetchJSON,
    getNetworkInfo,
    getPaymastersBalance,
    isSameChain,
    MissingVariableError,
    prepareVariables,
} from "./utils";
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
            toast.error(this.state.error?.message);
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
                    // const msg = `Could not fetch initial view due to: ${error}`;
                    this.setState(state => ({...state, error}));
                }
            );
    }

    fetchInitialUI = async () => {
        const contractABI = await this.getContractABI();
        this.setState(state => ({...state, contractABI}));

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

            return (
                this.state.web3provider ||
                (new BrowserProvider(window.ethereum as any)) as any  // this could be problematic
            );
        }

        if (!window.ethereum) {
            throw new Error("Could not connect to the wallet browser extension. Is it installed and activated?");
        }

        return new BrowserProvider(window.ethereum as any);
    }

    prepareExecutionReadOnly = async (functionABI: FunctionABI) => {
        const provider = this.getBrowserProvider(true);
        const contract = new ContractV6(this.state.contract.address, [functionABI], provider);

        return {contract, provider};
    }

    prepareExecutionWithUserSignature = async (functionABI: FunctionABI) => {
        const provider = this.getBrowserProvider(false);
        const signer = await provider.getSigner();
        const contract = new ContractV6(this.state.contract.address, [functionABI], signer);

        return {contract, signer, provider};
    };

    prepareExecutionViaRelay = async (functionABI: FunctionABI, paymasterAddress: string) => {
        function getPreferredRelays(chainId: string): string[] {
            const preferredRelays = getNetworkInfo(chainId)?.gsnPreferredRelays;

            if (!preferredRelays) {
                console.warn(`No preferred relays found for this network (${chainId}).`);
                return [];
            } else {
                console.debug(`Using preferred relays for this network (${chainId}):`, preferredRelays);
                return preferredRelays;
            }
        }

        const provider = this.getBrowserProvider(false);
        await this.validateProvider(provider);

        const {gsnProvider, gsnSigner} =
            await RelayProvider.newEthersV6Provider(
                {
                    provider: provider as any,
                    config: {
                        paymasterAddress,
                        performDryRunViewRelayCall: true,
                        loggerConfiguration: {logLevel: 'debug'},
                        preferredRelays: getPreferredRelays(this.state.contract.network),
                    }
                }
            );

        const contract = new ContractV6(this.state.contract.address, [functionABI], gsnSigner);

        return {contract: contract, signer: gsnSigner, provider: gsnProvider};
    };

    executeWithSignature = async (contract: ContractV6, functionName: string, functionArgs: any[]): Promise<ContractTransactionReceipt> => {
        try {
            this.setState(state => ({...state, walletRequestsPending: state.walletRequestsPending + 1}));

            console.log(
                "Call function:", functionName,
                "with arguments", functionArgs,
                "on contract at", await contract.getAddress(),
            );

            const contractCall = contract[functionName](...functionArgs);

            const tx = await toast.promise(
                contractCall,
                {
                    loading: "Waiting for signature...",
                    success: "Signature received.",
                    error: "Signature rejected.",
                }
            );

            const txReceipt: ContractTransactionReceipt = await toast.promise(
                tx.wait(),
                {
                    loading: "Waiting for the transaction...",
                    success: "Transaction confirmed.",
                    error: "Transaction failed...",
                }
            );

            if (!txReceipt) {
                throw new Error("No transaction receipt received.");
            }

            return txReceipt;
        } finally {
            this.setState(state => ({...state, walletRequestsPending: state.walletRequestsPending - 1}));
        }
    };

    executeGetUiResponse = async (contract: ContractV6, functionABI: FunctionABI, functionArgs: any[]) => {
        const contractResponse =
            await contract[functionABI.name](...functionArgs)
                .then(
                    x => {
                        console.debug(`Got response from ${functionABI.name}(${functionArgs}): ${x} of type ${typeof x}`);
                        return x;
                    }
                )
                .catch(
                    e => {
                        console.error(`Error calling ${functionABI.name}(${functionArgs}): ${e}`);
                        throw new Error(`Error calling contract function "${functionABI.name}"`);
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

    validateProvider = async (provider: Provider) => {
        // Chain ID
        {
            const contractChainId = BigInt(this.state.contract.network);
            const providerChainId = BigInt((await provider.getNetwork()).chainId);

            if (!isSameChain(contractChainId, providerChainId)) {
                throw new Error(`Contract chain ID (${contractChainId}) does not match user chain ID (${providerChainId}).`);
            }
        }
    }

    //
    // THIS FUNCTION IS TOO COMPLICATED. REFACTOR IT.
    //
    dispatchFunctionCall = async (eventDefinition: any, functionSelector: string, contractABI: any) => {
        console.debug("ContractUI.dispatchFunctionCall:", functionSelector, "of", eventDefinition);

        // Todo: allow a relative path to the new JSON instead of a function call to the contract

        contractABI = contractABI || this.state.contractABI;

        const nameOfFunction = eventDefinition[functionSelector];

        if (!nameOfFunction) {
            if ((functionSelector === FUNCTION_SELECTOR_FAILURE) || (functionSelector === FUNCTION_SELECTOR_SUCCESS)) {
                // If no failure/success function name is specified in the JSON,
                // we rely on the toasts to display the appropriate message.
                return;
            } else {
                throw new Error(`No function name found for selector '${functionSelector}' in the event definition.`);
            }
        }

        const functionABI = contractABI.find((abi: FunctionABI) => (abi.name === nameOfFunction));

        if (!functionABI) {
            console.error(`Function ABI ${nameOfFunction} not found in the contract ABI:`, contractABI);
            throw new Error(`Function ABI for '${nameOfFunction}' not found in the contract ABI.`);
        } else {
            console.log("Got function ABI:", functionABI);
        }

        if (!(["nonpayable", "payable", "view", "pure"].includes(functionABI.stateMutability))) {
            throw new Error(`Contract function ABI has invalid state mutability '${functionABI.stateMutability}'.`);
        }

        const functionArgs = prepareVariables(functionABI, this.state.getVariables());

        // Does it require no user signature to proceed?
        if (["view", "pure"].includes(functionABI.stateMutability)) {
            const {contract, provider} = await this.prepareExecutionReadOnly(functionABI);
            await this.validateProvider(provider);

            const response = await this.executeGetUiResponse(contract, functionABI, functionArgs);

            console.debug("ContractUI.dispatchFunctionCall: response:", response);

            this.setState(state => ({...state, ui: response.ui}));
            this.onVariablesUpdate(response.variables);

            return;
        }

        if (functionABI.stateMutability === "payable") {
            throw new Error(`Contract function ABI is 'payable', which is not implemented yet.`);
        }

        let paymasterAddress;
        let paymasterBalanceEth;

        if (eventDefinition?.gasless) {
            try {
                paymasterAddress = getAddress(this.state.getVariables()?.paymasterAddress);
            } catch (error) {
                console.warn(`No paymaster address provided for relay execution (${error})`);
            }

            if (paymasterAddress) try {
                paymasterBalanceEth = ethers.formatEther(
                    await getPaymastersBalance(
                        this.getBrowserProvider(true),
                        this.state.contract.network,
                        paymasterAddress
                    )
                );
            } catch {
                console.warn(`Could not get paymaster balance for ${paymasterAddress}`);
            }

            if (!paymasterAddress) {
                toast.error("No paymaster address provided for relay execution. This is a developer issue.");
            } else if (paymasterBalanceEth === undefined) {
                toast.error("Could not get the paymaster balance. This is a developer issue.");
            } else if (!paymasterBalanceEth) {
                toast.error("Paymaster balance on the relay is zero...");
            }

            console.log("Paymaster balance:", paymasterBalanceEth);
        }

        const {contract, provider} =
            (
                paymasterAddress && paymasterBalanceEth &&
                window.confirm(
                    "The contract offers to pay for the transaction. \n" +
                    "\n" +
                    "[Cancel] to pay yourself. [ OK ] to accept. \n" +
                    "\n" +
                    "Paymaster balance: " +
                    `${paymasterBalanceEth} (${getNetworkInfo(this.state.contract.network)?.nativeCurrency?.symbol || "native tokens"})`
                )
            ) ?
                await this.prepareExecutionViaRelay(functionABI, paymasterAddress) :
                await this.prepareExecutionWithUserSignature(functionABI);

        await this.validateProvider(provider);

        // This block involves signing and sending transactions.
        {
            try {
                // const balanceBefore = await provider.getBalance(signer.getAddress());

                const txReceipt = await this.executeWithSignature(contract, functionABI.name, functionArgs);

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

    handleExecutionOnClick = async (eventDefinition: any) => {
        this.setState(state => ({...state, executingCount: state.executingCount + 1}));

        try {
            await this
                .dispatchFunctionCall(eventDefinition, FUNCTION_SELECTOR_DEFAULT, this.state.contractABI)
                .then(this.props.scrollIntoViewRequest);
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

    // Notably, this handles the "Submit" button
    onEvent = async (name: string, eventDefinition: any, element: any) => {
        console.debug(name, eventDefinition, "from", element);

        if (name !== "onClick") {
            console.warn("Unhandled event:", name);
            return;
        }

        await this.handleExecutionOnClick(eventDefinition);
    };

    render = () => {
        if (!this.isReady()) {
            return;
        }

        return (
            <div ref={this.mainDiv} className="ContractUI">
                <div className={this.state.executingCount > 0 ? 'with-overlay' : 'no-overlay'}>
                    {
                        this.state.error ? (
                            <div className="error">
                                {this.state.error.message}
                            </div>
                        ) : (
                            this.state.ui ? (
                                <Web3ProviderContext.Provider value={this.state.web3provider}>
                                    <DynamicUI
                                        ui={this.state.ui}
                                        onEvent={this.onEvent}
                                        getVariables={this.state.getVariables}
                                        onVariablesUpdate={this.onVariablesUpdate}
                                    />
                                </Web3ProviderContext.Provider>
                            ) : (
                                <div>Loading the UI...</div>
                            )
                        )
                    }
                </div>
            </div>
        );
    }
};
