"""Read only eth_chainId through the setup proxy; never render provider text."""

import errno
from http.client import HTTPConnection, HTTPException
import json
import re
import sys


class ChainDiscoveryError(Exception):
    pass


def discover_chain_id():
    connection = HTTPConnection("rpc-proxy", 8080, timeout=20)
    try:
        connection.request("POST", "/", body=b'{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
                           headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        if response.status != 200:
            raise ChainDiscoveryError(f"RPC eth_chainId failed: HTTP {response.status}.")
        body = response.read(4097)
    except TimeoutError as error:
        raise ChainDiscoveryError("RPC eth_chainId timed out.") from error
    except OSError as error:
        code = errno.errorcode.get(error.errno)
        reason = f" ({code})" if code in {"ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"} else ""
        raise ChainDiscoveryError(f"RPC eth_chainId connection failed{reason}.") from error
    except HTTPException as error:
        raise ChainDiscoveryError("RPC eth_chainId response could not be read.") from error
    finally:
        connection.close()
    if len(body) > 4096:
        raise ChainDiscoveryError("RPC eth_chainId response exceeds 4096 bytes.")
    try:
        result = json.loads(body)
    except (ValueError, UnicodeError) as error:
        raise ChainDiscoveryError("RPC eth_chainId response is not valid JSON.") from error
    if not isinstance(result, dict) or result.get("jsonrpc") != "2.0" or type(result.get("id")) is not int or result["id"] != 1:
        raise ChainDiscoveryError("RPC eth_chainId response has an invalid or mismatched envelope.")
    if "error" in result:
        error = result["error"]
        if "result" in result or not isinstance(error, dict) or type(error.get("code")) is not int or not -(2**31) <= error["code"] < 2**31:
            raise ChainDiscoveryError("RPC eth_chainId response contains an invalid error.")
        raise ChainDiscoveryError(f"RPC eth_chainId rejected: JSON-RPC error {error['code']}.")
    chain = result.get("result")
    if not isinstance(chain, str) or re.fullmatch(r"0x[0-9a-fA-F]+", chain) is None or not 1 <= int(chain, 16) <= 9007199254740991:
        raise ChainDiscoveryError("RPC eth_chainId did not return a supported positive hexadecimal chain ID.")
    return int(chain, 16)


def main():
    try:
        print(discover_chain_id())
    except ChainDiscoveryError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2) from None
    except Exception:
        # This CLI is the disclosure boundary for untrusted provider responses.
        print("RPC eth_chainId failed while processing the response.", file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
