export async function POST(request: Request) {
    return new Response(
        JSON.stringify({hello: "world", method: "POST", body: await request.json()}),
        {
            headers: {"content-type": "application/json"},
        }
    );
}

export async function GET(request: Request) {
    return new Response(
        JSON.stringify({ok: false, message: "GET not allowed"}),
        {
            headers: {"content-type": "application/json"},
        }
    );
}
