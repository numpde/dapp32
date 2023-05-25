'use client';

import React, {useEffect, useState} from 'react';
import {ConnectWalletData, WalletState} from "../../../app/components/types";
import {Web3Provider} from "@ethersproject/providers";
import {ethers} from "ethers";


class Page extends React.Component<ConnectWalletData, WalletState> {
    constructor(props) {
        super(props);
        this.state = {
            provider: undefined,
        };
    }

    componentDidMount() {
        this.setState(state => ({...state, provider: window.ethereum}));
    }


    // console.log("HO");

    compute = () => {
        const {provider} = this.state;

        if (provider) {
            console.log("Provider:", provider);

            const paymasterAddress = "0xD833215cBcc3f914bD1C9ece3EE7BF8B14f841bb";


            const abi = {
                "name": "getRelayHub",
                "inputs": [],
                "outputs": [{"internalType": "address", "name": "", "type": "address"}],
                "stateMutability": "view",
                "type": "function"
            };

            // const signer = provider.getSigner();

            const web3provider = new Web3Provider(provider);
            const contract = new ethers.Contract(paymasterAddress, [abi], web3provider);

            contract.getAddress().then((address) => {
                console.log("Address:", address);
            });

            contract.getRelayHub().then((address) => {
                console.log("RelayHub:", address);
            });

        }

        return (
            <div></div>
        );
    }

    render() {
        return (
            <div>
                {this.compute()}
            </div>
        );
    }
};

export default Page;
