export async function GET(request: Request) {
    return new Response(
        JSON.stringify({hello: "world"}),
        {
            headers: {"content-type": "application/json"},
        }
    );
}
