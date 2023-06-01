export type Dapp32Props = {
    contract: {
        network: string,
        address: string,
        view: string,
    },

    params: {
        [key: string]: string | string[] | undefined,
    }
}

export type Dapp32State = {
    contract: Dapp32Props['contract'],
    walletState: WalletState | undefined,
    variables: VariablesOfUI,
}


export type WalletState = {
    network: string | undefined;
    account: string | undefined;
    isConnected: boolean | undefined;
}

export type ConnectWalletData = {
    defaultNetwork: string | undefined;
    onWalletInfoUpdate: (walletState: WalletState) => void;
}


export type VariablesOfUI = {
    userNetwork: string | undefined;
    userAddress: string | undefined;
    sessionID: string | undefined;

    [key: string]: any;
}


export type ContractUIProps = {
    contract: Dapp32Props['contract'];

    walletState: WalletState;

    getVariables: () => VariablesOfUI;
    onVariablesUpdate: (newVariables: VariablesOfUI) => void;

    scrollIntoViewRequest: () => void;
};

export type ContractUIState = {
    contract: ContractUIProps['contract'];
    contractABI: any;

    ui: any;

    getVariables: ContractUIProps['getVariables'];
    onVariablesUpdate: ContractUIProps['onVariablesUpdate'];

    scrollIntoViewRequest: () => void;

    executingCount: number;
    walletRequestsPending: number;

    error: Error | undefined;
};

export type FunctionABI = {
    name: string;
    inputs: Array<{ name: string, type: string }>;
    outputs: Array<{ name: string, type: string }>;
    stateMutability: string;
    type: string;
}
