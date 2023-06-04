'use client';

import './styles.css';

import React, {RefObject} from "react";

import {Dapp32Props, Dapp32State, VariablesOfUI, WalletState} from "./types";
import {ConnectWallet} from "./ConnectWallet";
import {ContractUI} from "./ContractUI";
import {ErrorBoundaryUI} from "./ErrorBoundaryUI";
import AppContainer from "./AppContainer";
import {humanizeChain} from "./utils";
import {debounce} from "lodash";


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
    contractDivRef: RefObject<HTMLDivElement> = React.createRef();
    variablesDivRef: RefObject<HTMLDivElement> = React.createRef();

    constructor(props: Dapp32Props) {
        super(props);

        this.state = {
            contract: props.contract,
            web3provider: props.web3provider,
            walletState: undefined,
            variables: {
                ...props.params,  // this goes first

                basePath: props.params.basePath,

                userNetwork: undefined,
                userAddress: undefined,
                sessionID: undefined,
            },
        };

        this.updateSpacerHeight = debounce(this.updateSpacerHeight.bind(this), 200);
    }

    componentDidMount() {
        window.addEventListener('scroll', this.updateSpacerHeight);

        const basePath = (typeof window !== 'undefined') && (window.location.origin + window.location.pathname) || undefined;

        if (basePath) {
            this.setState(state => ({...state, variables: {...state.variables, basePath}}));
        }
    }

    componentWillUnmount() {
        (this.updateSpacerHeight as any).cancel();
        window.removeEventListener('scroll', this.updateSpacerHeight);
    }

    updateSpacerHeight() {
        // const viewportHeight = window.innerHeight;
        // const div1top = this.contractDivRef.current?.getBoundingClientRect().top ?? 0;
        // const div2end = this.variablesDivRef.current?.getBoundingClientRect().bottom ?? 0;
        //
        // if ((0 <= div1top) && (div2end < viewportHeight)) {
        //     const newSpacerHeight = 100; //viewportHeight - (div2end - div1top);
        //     this.spacerDivRef.current?.style.setProperty('min-height', `${newSpacerHeight}px`);
        // } else {
        //     this.spacerDivRef.current?.style.setProperty('min-height', '0px');  // Reset the spacer height when not needed
        // }
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
        this.contractDivRef.current?.scrollIntoView({behavior: "smooth", block: "start", inline: "nearest"});
    }

    uiNotReadyMessageOrThis = (child: any) => {
        return (
            (!this.state.contract.address || !this.state.contract.network) ?
                <div>
                    Contract address/network not understood.
                </div>
                :
                <>
                    {
                        (!this.state.walletState || !this.state.walletState.account) && (
                            <div>
                                Wallet state not understood, the functionality of this page may be limited.
                            </div>
                        )
                    }

                    {
                        (this.state.walletState?.network) && (this.state.walletState?.network != this.state.contract.network) && (
                            <div>
                                Wallet network '{this.state.walletState?.network}' does not match
                                contract network '{this.state.contract.network}'.
                            </div>
                        )
                    }

                    {child}
                </>
        );
    };

    render() {
        const section = (header: string, contents: any, ref: React.RefObject<HTMLDivElement> | undefined) => {
            return (
                <div className={(header == "Contract UI") ? "section sticky" : "section"} ref={ref}>
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
                                        web3provider={this.state.web3provider}
                                        walletState={this.state.walletState}
                                        getVariables={() => this.state.variables}
                                        onVariablesUpdate={this.onVariablesUpdate}
                                        scrollIntoViewRequest={this.scrollIntoViewRequest}
                                    />
                                </ErrorBoundaryUI>
                            ),

                            this.contractDivRef  // ref to section
                        )
                    }

                    {
                        section(
                            "Local variables",
                            <VariableList variables={this.state.variables}/>,
                            this.variablesDivRef
                        )
                    }
                </div>
            </AppContainer>
        );
    }
}
