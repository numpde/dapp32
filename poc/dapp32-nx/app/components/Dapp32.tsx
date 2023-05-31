'use client';

import './styles.css';

import React, {RefObject} from "react";

import {Dapp32Props, Dapp32State, VariablesOfUI, WalletState} from "./types";
import {ConnectWallet} from "./ConnectWallet";
import {ContractUI} from "./ContractUI";
import {ErrorBoundaryUI} from "./ErrorBoundaryUI";
import AppContainer from "./AppContainer";
import {humanizeChain} from "./utils";


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
    contractDiv: RefObject<HTMLDivElement> = React.createRef();

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
            walletState: {...state.walletState, ...newWalletState},
        }));

        this.onVariablesUpdate({userNetwork: newWalletState.network, userAddress: newWalletState.account});
    };

    onVariablesUpdate = (newVariables: Partial<VariablesOfUI>) => {
        console.debug("Dapp32.onVariablesUpdate:", newVariables);
        this.setState((state) => ({
            ...state,
            variables: {...state.variables, ...newVariables},
        }));
    }

    scrollIntoViewRequest = () => {
        this.contractDiv.current?.scrollIntoView({behavior: "smooth", block: "start", inline: "nearest"});
    }

    uiNotReadyMessageOrThis = (child: any) => {
        return (
            (!this.state.contract.address || !this.state.contract.network) ?
                <div>
                    Contract address/network not understood.
                </div>
                :
                (!this.state.walletState || !this.state.walletState.account) ?
                    <div>
                        Wallet state not understood.
                    </div>
                    :
                    (this.state.contract.network != this.state.walletState.network) ?
                        <div>
                            Wallet network {this.state.walletState.network} does not match
                            contract network {this.state.contract.network}.
                        </div>
                        :
                        child
        );
    };

    render() {
        const section = (header: string, contents: any, ref: React.RefObject<HTMLDivElement> | undefined) => {
            return (
                <div className={`section`} ref={ref}>
                    <div className="section-header">{header}</div>
                    <div className="section-contents">{contents}</div>
                </div>
            );
        };

        return (
            <AppContainer>
                <div className="main">
                    {
                        section(
                            "Contract info",

                            <div>
                                <div>
                                    <span>Contract network: {humanizeChain(this.state.contract.network)}</span>
                                </div>
                                <div>
                                    <span>Contract address: {this.state.contract.address}</span>
                                </div>
                            </div>,

                            undefined
                        )
                    }

                    {
                        section(
                            "Wallet",

                            <ConnectWallet
                                defaultNetwork={this.state.contract.network}
                                onWalletInfoUpdate={this.handleWalletStateUpdate}
                            />,

                            undefined
                        )
                    }

                    {
                        section(
                            "Contract UI",

                            this.uiNotReadyMessageOrThis(
                                this.state.walletState &&
                                <ErrorBoundaryUI>
                                    <ContractUI
                                        contract={this.state.contract}
                                        walletState={this.state.walletState}
                                        getVariables={() => this.state.variables}
                                        onVariablesUpdate={this.onVariablesUpdate}
                                        scrollIntoViewRequest={this.scrollIntoViewRequest}
                                    />
                                </ErrorBoundaryUI>
                            ),

                            this.contractDiv  // ref to section
                        )
                    }

                    {
                        section(
                            "Local variables",
                            <VariableList variables={this.state.variables}/>,
                            undefined
                        )
                    }
                </div>
            </AppContainer>
        );
    }
}
