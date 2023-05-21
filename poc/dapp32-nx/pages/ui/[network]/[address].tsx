'use client';

import styles from './page.module.css';

import {useRouter} from 'next/router'
import {useState} from "react";

import {ConnectWallet, WalletState} from "../../../app/components/ConnectWallet";

const Page = () => {
    const router = useRouter()
    const {network: defaultNetwork, address} = router.query;

    const [walletState, setWalletState] = useState();

    if (Array.isArray(defaultNetwork)) {
        return <div>Could not parse network</div>
    }

    function handleWalletStateUpdate(newWalletState: WalletState) {
        setWalletState(newWalletState);
    }

    async function checkBalance() {
        console.log("Wallet state:", walletState);

    }

    return (
        <div>
            <div>
                <button onClick={checkBalance}>Check Balance</button>
            </div>
            {
                !defaultNetwork ? <div>Loading...</div> : (
                    <div>
                        <ConnectWallet defaultNetwork={defaultNetwork} onWalletInfoUpdate={handleWalletStateUpdate}/>
                    </div>
                )
            }
        </div>
    );
};

export default Page
