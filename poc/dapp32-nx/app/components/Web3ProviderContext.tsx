import React from 'react';
import {JsonRpcApiProvider} from "ethers";

const Web3ProviderContext = React.createContext<JsonRpcApiProvider | null>(
    null
);

export default Web3ProviderContext;
