import React from 'react';

import {DynamicUI} from "./DynamicUI";
import {ContractUIProps, ContractUIState, FunctionABI, VariablesOfUI} from "./types";


const INITIAL_VIEW_FUNCTION_ABI: FunctionABI = {
    name: "getInitialView",
    inputs: [],
    outputs: [{name: "uiSpec", type: "string"}],
    stateMutability: "view",
    type: "function",
};

export class ContractUI extends React.Component<ContractUIProps, ContractUIState> {
    constructor(props: ContractUIProps) {
        super(props)

        this.state = {
            contract: props.contract,

            ui: undefined,

            variables: props.variables,
            onVariablesUpdate: props.onVariablesUpdate,
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
        this.setState((state) => ({...state, variables: {...state.variables, ...newVariables}}));
        this.state.onVariablesUpdate(newVariables);
    }

    componentDidMount() {
        const initialFunctionABI = {
            ...INITIAL_VIEW_FUNCTION_ABI,
            name: this.state.contract.view,
        };

        this.retrieveNextUI(initialFunctionABI, this.state.variables).then(
            //
        ).catch(
            console.error
        );
    }

    retrieveNextUI = async (functionABI: FunctionABI, variables: VariablesOfUI) => {
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

        this.setState({...this.state, ui: response?.uiSpec})
    };

    // Notably, this handles the Submit button
    onEvent = (name: string, eventDefinition: any, element: any) => {
        console.debug(name, eventDefinition, "from", element);

        if (name !== "onClick") {
            console.warn("Unhandled event:", name);
            return;
        }

        const contractFunctionABI = eventDefinition.functionABI;

        if (!contractFunctionABI) {
            console.error(`Contract function ABI not found for event ${name} / ${JSON.stringify(eventDefinition)}`);
            return;
        }

        this.retrieveNextUI(contractFunctionABI, this.state.variables)
            .then()
            .catch(console.error);
    };

    render = () => {
        if (!this.isReady()) {
            return;
        }

        return (
            <div>
                <div>Contract network: {this.state.contract.network}</div>
                <div>Contract address: {this.state.contract.address}</div>
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
        );
    }
}
