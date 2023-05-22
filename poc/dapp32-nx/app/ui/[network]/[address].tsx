'use client';

import './styles.css';

import {useRouter} from 'next/router'
import {useState} from "react";

import {ConnectWallet, WalletState} from "../../components/ConnectWallet";
import {ContractUI} from "../../components/ContractUI";

export const Dapp32 = () => {
    const router = useRouter()
    const {network: contractNetwork, address: contractAddress} = router.query;

    const [walletState, setWalletState] = useState();

    if (Array.isArray(contractNetwork) || Array.isArray(contractAddress)) {
        return <div>Could not parse contract network/address</div>
    }

    function handleWalletStateUpdate(newWalletState: WalletState) {
        setWalletState(newWalletState);
    }

    async function checkBalance() {
        console.log("Wallet state:", walletState);

        const {network, account} = walletState;

        const responseJSON = await fetch('/api/balanceOf', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({network, account}),
        }).then(
            response => response.json()
        )

        console.log(responseJSON);

        // if (!response.ok) {
        //     throw new Error(`HTTP error! status: ${response.status}`);
        // }
        //
        // const balance = await response.json();
        //
        // this.setState({balance});

    }

    return (
        <div className="container">
            {!contractNetwork ?
                <div className="item">Loading wallet info...</div>
                :
                <div className="item">
                    <ConnectWallet
                        defaultNetwork={contractNetwork}
                        onWalletInfoUpdate={handleWalletStateUpdate}
                    />
                </div>
            }
            {!(contractNetwork && contractAddress && walletState) ?
                <div className="item">Loading contract info...</div>
                :
                <div className="item">
                    <ContractUI
                        contractNetwork={contractNetwork}
                        contractAddress={contractAddress}
                        walletState={walletState}
                    />
                </div>
            }
        </div>

    );
};
