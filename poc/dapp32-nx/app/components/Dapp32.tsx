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
                <div key={name}>{name}: {value}</div>
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
        console.debug("handleWalletStateUpdate:", newWalletState);
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
        console.debug("onVariablesUpdate:", newVariables);
        this.setState((state) => ({...state, variables: {...state.variables, ...newVariables}}));
    }

    render() {
        // const router = useRouter();
        // const {network: contractNetwork, address: contractAddress, view: entryFunction} = router.query;

        return (
            <div className="container">
                <div className="item">
                    <ConnectWallet
                        defaultNetwork={this.state.contract.network}
                        onWalletInfoUpdate={this.handleWalletStateUpdate}
                    />
                </div>
                {
                    !(this.state.walletState && this.state.contract.address && this.state.contract.network) ?
                        <div className="item">Loading wallet state and contract info...</div>
                        :
                        <div className="item">
                            <ContractUI
                                contract={this.state.contract}
                                walletState={this.state.walletState}
                                variables={this.state.variables}
                                onVariablesUpdate={this.onVariablesUpdate}
                            />
                        </div>
                }
                <VariableList variables={this.state.variables}/>
            </div>
        );
    }
}
