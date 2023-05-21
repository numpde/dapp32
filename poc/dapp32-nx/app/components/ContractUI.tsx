import React from "react";
import {COMPONENT_MAP} from "./ComponentMap";
import {toKeyAlias} from "@babel/types";
import uid = toKeyAlias.uid;

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


const DynamicUI = ({ui}) => (
    <div>
        {ui.elements.map((element, i) => {
            const Element = COMPONENT_MAP[element.type];
            return Element ? <div><Element {...element} key={i}/></div> : null;
        })}
    </div>
);


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

    loadUI = async () => {
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

                    method: 'getInitialView',
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

    render() {
        return !this.isReady() ? (<div></div>) : (
            <div>
                <div>Contract network: {this.state.contractNetwork}</div>
                <div>Contract address: {this.state.contractAddress}</div>
                {
                    !this.state.ui ?
                        <button onClick={this.loadUI}>Load UI</button>
                        :
                        <DynamicUI ui={this.state.ui}/>
                }
            </div>
        )
    }
}
