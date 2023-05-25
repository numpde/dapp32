'use client';

import './styles.css';

import React from "react";

import {Dapp32Props, Dapp32State, VariablesOfUI, WalletState} from "./types";
import {ConnectWallet} from "./ConnectWallet";
import {ContractUI} from "./ContractUI";


const VariableList = ({variables}: { variables: VariablesOfUI }) => (
    <div>
        {
            Object.entries(variables).map(([name, value]) => (
                <div key={name}><span>{name}: {value}</span></div>
            ))
        }
    </div>
);


export class Dapp32 extends React.Component<Dapp32Props, Dapp32State> {
    constructor(props: Dapp32Props) {
        super(props);

        // if (Object.values(props.contract).some((v) => (typeof v !== 'string'))) {
        //     throw new Error(`Invalid contract info ${JSON.stringify(props.contract)}, expected {network: string, address: string, view: string}`);
        // }

        this.state = {
            contract: props.contract,
            walletState: undefined,
            variables: {
                userNetwork: undefined,
                userAddress: undefined,
                sessionID: undefined,
            },
        };
    }

    handleWalletStateUpdate = (newWalletState: WalletState) => {
        console.debug(`${typeof this}.handleWalletStateUpdate:`, newWalletState);
        this.setState(state => ({
            ...state,
            walletState: newWalletState,
            variables: {
                ...state.variables,
                userNetwork: newWalletState.network,
                userAddress: newWalletState.account,
            }
        }));
    }

    onVariablesUpdate = (newVariables: VariablesOfUI) => {
        console.debug("Dapp32.onVariablesUpdate:", newVariables);
        this.setState((state) => ({...state, variables: {...state.variables, ...newVariables}}));
    }

    render() {
        const section = (header: string, contents: any) => {
            return (
                <div className={`section`}>
                    <div className="section-header">{header}</div>
                    <div className="section-contents">{contents}</div>
                </div>
            );
        };

        return (
            <div className="main">
                {
                    section(
                        "Wallet",

                        <ConnectWallet
                            defaultNetwork={this.state.contract.network}
                            onWalletInfoUpdate={this.handleWalletStateUpdate}
                        />
                    )
                }

                {
                    section(
                        "Contract",

                        <div>
                            <div>
                                <span>Contract network: {this.state.contract.network}</span>
                            </div>
                            <div>
                                <span>Contract address: {this.state.contract.address}</span>
                            </div>
                        </div>
                    )
                }

                {
                    section(
                        "Contract says:",

                        (this.state.walletState && this.state.contract.address && this.state.contract.network)
                        &&
                        <ContractUI
                            contract={this.state.contract}
                            walletState={this.state.walletState}
                            variables={this.state.variables}
                            onVariablesUpdate={this.onVariablesUpdate}
                        />
                        ||
                        <div className="item">Loading contract info...</div>
                    )
                }

                {
                    section(
                        "Variables",
                        <VariableList variables={this.state.variables}/>
                    )
                }
            </div>
        );
    }
}
