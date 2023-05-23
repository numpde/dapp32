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
