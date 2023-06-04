import React from "react";

// @ts-ignore
import {isEqual} from 'lodash';

import {toast} from "react-hot-toast";

import './styles.css';
import {ConnectWalletData, WalletState} from "./types";
import {humanizeChain} from "./utils";


interface Ethereum {
    selectedAddress: string | null;
    on: (eventName: string, handler: (...args: any[]) => void) => void;
    off: (eventName: string, handler: (...args: any[]) => void) => void;
    request: (request: { method: string; params?: any[] }) => Promise<any>;
    removeListener: (eventName: string, handler: (...args: any[]) => void) => void;
}

declare global {
    interface Window {
        ethereum?: Ethereum;
    }
}

export class ConnectWallet extends React.Component<ConnectWalletData, WalletState> {
    constructor(props: ConnectWalletData) {
        super(props);

        this.state = {
            network: undefined,
            account: undefined,
            isConnected: undefined,
        };
    }

    componentDidUpdate(prevProps: ConnectWalletData, prevState: WalletState) {
        if (!isEqual(prevState, this.state)) {
            console.debug("ConnectWallet.componentDidUpdate", prevProps, "prevState:", prevState, "currState:", this.state);
            this.props?.onWalletInfoUpdate(this.state);
        }
    }

    componentDidMount = async () => {
        const network = await this.getCurrentNetwork();
        const account = await this.getCurrentAccount();

        const state: WalletState = {
            network: network,
            account: account,
            isConnected: !!account
        };

        this.setState(state);

        if (window?.ethereum?.on) {
            window.ethereum.on('accountsChanged', this.handleAccountsChanged);
            window.ethereum.on('chainChanged', this.handleChainChanged);
        }
    }

    componentWillUnmount() {
        if (window?.ethereum?.off) {
            window.ethereum.off('accountsChanged', this.handleAccountsChanged);
            window.ethereum.off('chainChanged', this.handleChainChanged);
        }
    }

    handleAccountsChanged = async (accounts: any) => {
        const account = accounts && accounts[0];
        this.setState(state => ({...state, account, isConnected: !!account}));
    }

    handleChainChanged = async (chainId: any) => {
        this.setState(state => ({...state, network: chainId}));
    }

    getCurrentNetwork = async () => {
        return window.ethereum?.request({method: 'eth_chainId'});
    }

    getCurrentAccount = async () => {
        return window.ethereum?.request({method: 'eth_accounts'}).then(
            accounts => (accounts && accounts[0])
        ).catch(
            console.info
        )
    };

    connect = async () => {
        if (!window.ethereum) {
            toast.error("Please install a wallet browser extension such as Metamask.");
            return;
        }

        window.ethereum?.request({method: 'eth_requestAccounts'}).then(
            // `handleAccountsChanged` will be invoked
        ).catch(
            toast.error
        )
    }

    requestSwitchToDefaultNetwork = async () => {
        window.ethereum?.request(
            {
                method: 'wallet_switchEthereumChain',
                params: [{chainId: this.props.defaultNetwork}],
            }
        ).then(
            //
        ).catch(
            console.info
        );

        const currentNetwork = await this.getCurrentNetwork();
        this.setState(state => ({...state, network: currentNetwork}));
    }

    // signMessage = async () => {
    //     const message = 'Hello World';
    //
    //     const signature = await window.ethereum?.request({
    //         method: 'personal_sign',
    //         params: [message, this.state.account],
    //     });
    //
    //     console.log("MyApp.signMessage", signature);
    // }

    render() {
        const {isConnected, account, network} = this.state;

        return (
            <div className={`fade-in ${(isConnected !== undefined) ? 'show' : ''}`}>
                {
                    isConnected
                        ?
                        <>
                            <div><span>Network: {humanizeChain(network)}</span></div>
                            <div><span>Account: {account || 'Not connected'}</span></div>
                        </>
                        :
                        <button onClick={this.connect} disabled={!!isConnected}>
                            {isConnected ? 'Connected to wallet' : 'Connect to wallet...'}
                        </button>
                }

                {
                    network && this.props.defaultNetwork && (network !== this.props.defaultNetwork) && (
                        <div>
                            <div>
                                <button onClick={this.requestSwitchToDefaultNetwork}>Switch to default network</button>
                            </div>
                            <div>Not on the default network {this.props.defaultNetwork}.</div>
                        </div>
                    )
                }
            </div>
        );
    }
}
