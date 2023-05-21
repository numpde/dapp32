'use client';

import styles from './page.module.css';

import {useState} from "react";

import {ConnectWallet} from "./components/ConnectWallet";

const DEFAULT_NETWORK = '0x89';

export default function Index() {
    const [walletData, setWalletData] = useState({address: null, network: null});

    async function checkBalance() {
        // Similar to previous example but now use walletData.address and walletData.network
    }

    function handleWalletConnect(walletData) {
        console.log("handleWalletConnect", walletData);
        setWalletData(walletData);
    }

    return (
        <div>
            {/*<ConnectWallet onConnect={handleWalletConnect}/>*/}
            {/*<p>Balance: {balance}</p>*/}
            <button onClick={checkBalance}>Check Balance</button>

            <ConnectWallet defaultNetwork={}/>
        </div>
    );
}
