import React, {useCallback, useEffect, useMemo} from 'react';
import objectHash from 'object-hash';
import PropTypes from 'prop-types';

import {COMPONENT_MAP} from "./ComponentMap";

interface ContractUIProps {
    contractNetwork: string;
    contractAddress: string;
}

interface ContractUIState {
    contractNetwork: string;
    contractAddress: string;

    userNetwork: string | undefined;
    userAddress: string | undefined;

    ui: any;
}


const DynamicUI = ({ui, onEvent}) => {
    useEffect(() => {
        console.log("DynamicUI: onEvent changed");
    }, [onEvent]);

    const createEventHandler = useCallback((eventDefinition, element) => {
        return () => (eventDefinition && onEvent(eventDefinition, element));
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
                        onClick={createEventHandler(onClickDefinition, element)}
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


export class ContractUI extends React.Component<ContractUIProps, ContractUIState> {
    constructor(props: ContractUIProps) {
        super(props)

        this.state = {
            ...props,

            userNetwork: undefined,
            userAddress: undefined,

            ui: undefined,
        }
    }

    isReady = () => {
        return this.state.contractNetwork && this.state.contractAddress;
    }

    // getContractFunctionABI = (method) => {
    //     return this.state.contractABI.find((abi) => abi.name === method);
    // }

    uiLoader = (method) => {
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

                        userNetwork: this.state.userNetwork,
                        userAddress: this.state.userAddress,

                        method: method,
                    }),
                },
            ).then(
                response => response.json()
            ).catch(
                console.error
            )

            console.log("Response:", response);

            if (response) {
                this.setState({...this.state, ui: response?.viewSpec})
            }
        };
    };

    onEvent = async (eventDefinition, element) => {
        console.log("onEvent", eventDefinition, "from", element);
    }

    render() {
        return !this.isReady() ? (<div></div>) : (
            <div>
                <div>Contract network: {this.state.contractNetwork}</div>
                <div>Contract address: {this.state.contractAddress}</div>
                {
                    !this.state.ui ?
                        <button onClick={this.uiLoader('getInitialView')}>Load UI</button>
                        :
                        <DynamicUI ui={this.state.ui} onEvent={this.onEvent}/>
                }
            </div>
        )
    }
}
