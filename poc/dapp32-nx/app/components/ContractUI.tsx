import React from 'react';

import {DynamicUI} from "./DynamicUI";
import {ContractUIProps, ContractUIState, FunctionABI, VariablesOfUI} from "./types";


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

    INITIAL_VIEW_FUNCTION_ABI: FunctionABI = {
        name: "getInitialView",
        inputs: [],
        outputs: [{name: "uiSpec", type: "string"}],
        stateMutability: "view",
        type: "function",
    };

    isReady = () => {
        return this.state.contract.network && this.state.contract.address;
    }

    // getContractFunctionABI = (method) => {
    //     return this.state.contractABI.find((abi) => abi.name === method);
    // }

    retrieveUISpec = async (functionABI: FunctionABI) => {
        const variables = this.state.variables;

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
                    variables: this.state.variables,
                }),
            },
        ).then(
            r => r.json()
        ).catch(
            console.error
        )

        if (response) {
            console.log("Response:", response);
            this.setState({...this.state, ui: response?.uiSpec})
        }
    };

    // Notably, this handles the Submit button
    onEvent = async (name: string, eventDefinition: any, element: any) => {
        console.debug(name, eventDefinition, "from", element);

        if (name !== "onClick") {
            console.warn("Unknown event", name);
            return;
        }

        const contractFunctionABI = eventDefinition.functionABI;

        if (!contractFunctionABI) {
            console.error("Contract function not found for event", name, eventDefinition);
            return;
        }

        const uiSpecLoader = await this.retrieveUISpec(contractFunctionABI);
    };

    render() {
        return !this.isReady() ? (<div></div>) : (
            <div>
                <div>Contract network: {this.state.contract.network}</div>
                <div>Contract address: {this.state.contract.address}</div>
                {
                    !this.state.ui ?
                        <button onClick={() => this.retrieveUISpec(this.INITIAL_VIEW_FUNCTION_ABI)}>Load UI</button>
                        :
                        <DynamicUI
                            ui={this.state.ui}
                            onEvent={this.onEvent}
                            variables={this.state.variables}
                            onVariablesUpdate={this.state.onVariablesUpdate}
                        />
                }
            </div>
        )
    }
}
