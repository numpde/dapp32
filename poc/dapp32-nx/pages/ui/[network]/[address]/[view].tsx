import {Dapp32} from "../../../../app/components/Dapp32"
import {GetServerSideProps, GetServerSidePropsContext} from "next";

type Route = {
    contractNetwork: string,
    contractAddress: string,
    initialView: string,
    basePath: string | undefined,
    params: { [key: string]: string | string[] | undefined },
};

const getRoute = (context: GetServerSidePropsContext): Route => {
    const {
        network: contractNetwork,
        address: contractAddress,
        view: initialView,
        ...params
    } = context.query;

    if (Array.isArray(contractNetwork) || Array.isArray(contractAddress) || Array.isArray(initialView)) {
        throw new Error("Could not parse contract network/address/view");
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

    // Pass data to the page via props
    return {props: {route}}
}


const Page: React.FC<{ route: Route }> = ({route}) => {
    return (
        <Dapp32
            contract={
                {
                    network: route.contractNetwork,
                    address: route.contractAddress,
                    view: route.initialView,
                }
            }
            params={
                {
                    ...route.params,
                    basePath: route.basePath
                }
            }
        />
    );
};


export default Page;
