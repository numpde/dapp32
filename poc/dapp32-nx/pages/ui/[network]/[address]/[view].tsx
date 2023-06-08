import {GetServerSideProps, GetServerSidePropsContext} from "next";
import {useMemo, useState} from "react";
import {Toaster} from "react-hot-toast";

// questionable choice
import {StaticJsonRpcProvider} from "@ethersproject/providers";

import {Dapp32} from "../../../../app/components/Dapp32"
import {isSameChain} from "../../../../app/components/utils";
import {Dapp32Props} from "../../../../app/components/types";

type ProviderType = Dapp32Props['web3provider'];

type Route = {
    contractNetwork: string,
    contractAddress: string,
    initialView: string,
    basePath: string | undefined,
    params: { [key: string]: string | string[] | undefined },
};

type PageProps = {
    route: Route,
    web3provider: ProviderType,
}

const getRoute = (context: GetServerSidePropsContext): Route => {
    const {
        network: contractNetwork,
        address: contractAddress,
        view: initialView,
        ...params
    } = context.query;

    if (Array.isArray(contractNetwork) || Array.isArray(contractAddress) || Array.isArray(initialView)) {
        throw new Error("Could not parse contract network/address/view.");
    }

    if (!contractNetwork || !contractAddress || !initialView) {
        throw new Error("Could not get contract network/address/view.");
    }

    const basePath = context.req.headers.referer ?
        context.req.headers.referer.split('?')[0] :
        (
            "https://" + context.req.headers.host + (
                context.req.url ? context.req.url.split('?')[0] : ""
            )
        );

    const route: Route = {
        contractNetwork,
        contractAddress,
        initialView,
        basePath,
        params,
    }

    return route;
};


export const getServerSideProps: GetServerSideProps = async (context) => {
    const route = getRoute(context);

    if (!route.contractNetwork || !route.contractAddress || !route.initialView) {
        return {
            notFound: true,
        }
    }

    return {props: {route}}
}


async function getWorkingProvider(chainId: string): Promise<ProviderType | null> {
    interface NetworkEntry {
        chainId: string;
        rpc: string[];
    }

    const providerUrls = isSameChain(chainId, "5777") ?
        [
            'http://localhost:8545',
            'http://localhost:7545',
        ] :
        (require('../../../../chainlist/my.chainid.network.json') as NetworkEntry[])
            .find((network: NetworkEntry) => isSameChain(chainId, network.chainId))
            ?.rpc || [];

    const TIMEOUT_MS = 3000;

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Provider request timed out.')), TIMEOUT_MS);
    });

    const providerPromises: Array<Promise<ProviderType>> = providerUrls.map((url) =>
        new Promise<ProviderType>(async (resolve, reject) => {
            try {
                const provider = new StaticJsonRpcProvider(url);
                await provider.getNetwork();
                resolve(provider);
            } catch (error) {
                console.log(`Failed to get network for provider at ${url}: ${error}`);
            }
        }));

    try {
        const fastestProvider = await Promise.race([...providerPromises, timeoutPromise]);
        console.debug("Chosen provider:", fastestProvider);
        return fastestProvider;
    } catch (error) {
        console.info(error);
        return null;
    }
}


const Page: React.FC<PageProps> = ({route}) => {
    const [web3provider, setWeb3provider] = useState<ProviderType | null | undefined>(undefined);

    useMemo(() => {
        getWorkingProvider(route.contractNetwork).then(setWeb3provider)
    }, []);

    if (web3provider === undefined) {
        return <div>Loading...</div>;
    } else {
        console.log("web3provider:", web3provider);
    }

    return (
        <div>
            <Toaster
                position="bottom-right"
                reverseOrder={false}
            />

            <Dapp32
                contract={{
                    network: route.contractNetwork,
                    address: route.contractAddress,
                    view: route.initialView,
                }}
                web3provider={web3provider}
                params={
                    {
                        ...route.params,
                        basePath: route.basePath
                    }
                }
            />
        </div>
    );
};


export default Page;
