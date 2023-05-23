import React, {useCallback, useEffect, useMemo} from 'react';
import objectHash from 'object-hash';
import PropTypes from 'prop-types';

import {COMPONENT_MAP} from "./ComponentMap";
import {WalletState} from "./ConnectWallet";

interface ContractUIProps {
    contractNetwork: string;
    contractAddress: string;

    walletState: WalletState;

    onVariableUpdate: (name: string, value: any) => void;
}

interface ContractUIState {
    contractNetwork: string;
    contractAddress: string;
    ui: any;
    variables: {
        userNetwork: string | undefined;
        userAddress: string | undefined;

        [key: string]: any;
    };
}

export interface FunctionABI {
    name: string;
    inputs: Array<{ name: string, type: string }>;
    outputs: Array<{ name: string, type: string }>;
    stateMutability: string;
    type: string;
}


const DynamicUI = ({ui, onEvent, variables, onVariableUpdate}) => {
    useEffect(() => {
        console.log("DynamicUI: onEvent changed");
    }, [onEvent]);

    const createEventHandler = useCallback((name, eventDefinition, element) => {
        return () => (eventDefinition && onEvent(name, eventDefinition, element));
    }, [onEvent]);

    const elements = useMemo(() => {
        return ui.elements.map((element) => {
            const ElementComponent = COMPONENT_MAP[element.type];

            if (!ElementComponent) {
                console.error(`Unknown component type: ${element.type}`);
                return null;
            }

            const key = element.id || objectHash(element);

            const {onClick: onClickDefinition, ...elementProps} = element;

            return (
                <div key={key}>
                    <ElementComponent
                        {...elementProps}
                        onClick={createEventHandler('onClick', onClickDefinition, element)}
                        value={variables[element.id]}
                        onVariableUpdate={onVariableUpdate}
                    />
                </div>
            );
        });
    }, [ui.elements, createEventHandler]);

    return <div key={objectHash(ui)}>{elements}</div>;
};

DynamicUI.propTypes = {
    ui: PropTypes.shape({
        elements: PropTypes.arrayOf(PropTypes.object).isRequired,
    }).isRequired,
    onEvent: PropTypes.func.isRequired,
};


const VariableList = ({variables}) => (
    <div>
        {
            Object.entries(variables).map(([name, value]) => (
                <div key={name}>{name}: {value}</div>
            ))
        }
    </div>
);

export class ContractUI extends React.Component<ContractUIProps, ContractUIState> {
    constructor(props: ContractUIProps) {
        super(props)

        this.state = {
            contractNetwork: props.contractNetwork,
            contractAddress: props.contractAddress,

            ui: undefined,

            variables: {
                userNetwork: props.walletState.network,
                userAddress: props.walletState.account,
            },
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
        return this.state.contractNetwork && this.state.contractAddress;
    }

    // getContractFunctionABI = (method) => {
    //     return this.state.contractABI.find((abi) => abi.name === method);
    // }

    uiSpecLoader = (contractFunctionABI) => {
        return async () => {
            const response = await fetch("/api/ui",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        contractNetwork: this.state.contractNetwork,
                        contractAddress: this.state.contractAddress,

                        functionABI: contractFunctionABI,
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
    };

    // Notably, this handles the Submit button
    onEvent = async (name, eventDefinition, element) => {
        console.log(name, eventDefinition, "from", element);

        if (name !== "onClick") {
            console.warn("Unknown event", name);
            return;
        }

        const contractFunctionABI = eventDefinition.functionABI;

        if (!contractFunctionABI) {
            console.error("Contract function not found for event", name, eventDefinition);
            return;
        }

        const uiSpecLoader = this.uiSpecLoader(contractFunctionABI);

        await uiSpecLoader();
    };

    onVariableUpdate = (name, value) => {
        console.log("onVariableUpdate:", name, "=", value);
        this.setState((state) => ({...state, variables: {...state.variables, [name]: (value || '') as string}}));
    }

    render() {
        return !this.isReady() ? (<div></div>) : (
            <div>
                <div>Contract network: {this.state.contractNetwork}</div>
                <div>Contract address: {this.state.contractAddress}</div>
                {
                    !this.state.ui ?
                        <button onClick={this.uiSpecLoader(this.INITIAL_VIEW_FUNCTION_ABI)}>Load UI</button>
                        :
                        <DynamicUI
                            ui={this.state.ui}
                            onEvent={this.onEvent}
                            variables={this.state.variables}
                            onVariableUpdate={this.onVariableUpdate}
                        />
                }
                <VariableList variables={this.state.variables}/>
            </div>
        )
    }
}
