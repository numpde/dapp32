import {StaticJsonRpcProvider} from "@ethersproject/providers";

export type Dapp32Props = {
    contract: {
        network: string,
        address: string,
        view: string,
    },

    web3provider: StaticJsonRpcProvider | null,

    params: {
        [key: string]: string | string[] | undefined,
    }
}

export type Dapp32State = {
    contract: Dapp32Props['contract'],
    web3provider: Dapp32Props['web3provider'],
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

    web3provider: Dapp32Props['web3provider'];

    walletState: WalletState;

    getVariables: () => VariablesOfUI;
    onVariablesUpdate: (newVariables: VariablesOfUI) => void;

    scrollIntoViewRequest: () => void;
};

export type ContractUIState = {
    contract: ContractUIProps['contract'];
    contractABI: any;

    web3provider: Dapp32Props['web3provider'];

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


export type ComponentProps = {
    id: string,
    variables: VariablesOfUI,
    label?: string,
    onClick?: () => void,
    placeholder?: string,
    value?: string,
    options?: string[],
    onVariablesUpdate?: (value: Record<string, unknown>) => void,
    readOnly?: boolean,
    params?: any,
}
