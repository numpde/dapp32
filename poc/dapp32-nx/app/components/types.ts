export type Dapp32Props = {
    contract: {
        network: string,
        address: string,
        view: string,
    },
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

    variables: VariablesOfUI;
    onVariablesUpdate: (newVariables: VariablesOfUI) => void;
};

export type ContractUIState = {
    contract: ContractUIProps['contract'];

    ui: any;

    variables: ContractUIProps['variables'];
    onVariablesUpdate: ContractUIProps['onVariablesUpdate'];

    executingCount: number;
    walletRequestsPending: number;
};

export type FunctionABI = {
    name: string;
    inputs: Array<{ name: string, type: string }>;
    outputs: Array<{ name: string, type: string }>;
    stateMutability: string;
    type: string;
}
