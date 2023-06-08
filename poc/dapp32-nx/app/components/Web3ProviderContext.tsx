import React from 'react';
import {Dapp32Props} from "./types";

const Web3ProviderContext = React.createContext<Dapp32Props['web3provider'] | null>(
    null
);

export default Web3ProviderContext;
