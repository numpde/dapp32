import React from 'react';
import {JsonRpcProvider} from "ethers";

const Web3ProviderContext = React.createContext<JsonRpcProvider | null>(
    null
);

export default Web3ProviderContext;
