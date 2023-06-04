import {GetServerSideProps, GetServerSidePropsContext} from "next";

import {JsonRpcProvider, Network} from 'ethers';

import {Dapp32} from "../../../../app/components/Dapp32"
import {useEffect, useMemo, useState} from "react";
import {Toaster} from "react-hot-toast";
import {requirePage} from "next/dist/server/require";
import {isSameChain} from "../../../../app/components/utils";


type Route = {
    contractNetwork: string,
    contractAddress: string,
    initialView: string,
    basePath: string | undefined,
    params: { [key: string]: string | string[] | undefined },
};

type PageProps = {
    route: Route,
    web3provider: JsonRpcProvider,
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


async function getWorkingProvider(chainId: string): Promise<JsonRpcProvider | null> {
    const providerUrls = isSameChain(chainId, 5777) ?
        [
            'http://localhost:8545',
            'http://localhost:7545',
        ] :
        require(
            '../../../../chainlist/chainid.network.json'
        ).find(
            (network: any) => isSameChain(chainId, network.chainId)
        ).rpc;

    for (const url of providerUrls) {
        try {
            const provider = new JsonRpcProvider(url);
            await provider.getNetwork();
            return provider;
        } catch (error) {
            console.info(`Failed to get network for provider at ${url}:`, error);
        }
    }

    return null;
}


const Page: React.FC<PageProps> = ({route}) => {
    const [web3provider, setWeb3provider] = useState<JsonRpcProvider | null | undefined>(undefined);

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
