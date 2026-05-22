pragma solidity 0.8.35;

import {DepositVault} from "../../src/DepositVault.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
    function expectRevert() external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address msgSender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 newTimestamp) external;
}

/// @dev Minimal ERC-20 test double for exercising DepositVault transfer paths.
contract MockERC20 {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        uint256 allowed = allowance[from][msg.sender];

        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }

        balanceOf[from] -= amount;
        balanceOf[to] += amount;

        return true;
    }
}

/// @dev Token double that models fee-on-transfer behavior rejected by the vault.
contract FeeOnTransferERC20 is MockERC20 {
    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];

        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }

        balanceOf[from] -= amount;
        balanceOf[to] += amount - 1;

        return true;
    }
}

/// @dev Token double that models an ERC-20 returning false from transferFrom.
contract FalseReturnERC20 is MockERC20 {
    function transferFrom(address, address, uint256) external pure override returns (bool) {
        return false;
    }
}

/// @notice Unit tests for DepositVault, an EIP-712-authorized ERC-20 deposit gateway.
/// @dev The SUT should move exact token amounts to treasury only for current,
///      backend-signed intents while preserving nonce, signer, owner, pause,
///      token allowlist, and treasury controls.
contract DepositVaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant SIGNER_KEY = 0xA11CE;
    uint256 private constant OTHER_SIGNER_KEY = 0xB0B;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant DEPOSIT_INTENT_TYPEHASH = keccak256(
        "DepositIntent(bytes32 paymentRef,address payer,address token,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    address private owner = address(this);
    address private treasury = address(0x7100);
    address private payer = address(0xCAFE);
    address private intentSigner;

    DepositVault private vault;
    MockERC20 private token;

    event DepositReceived(
        bytes32 indexed paymentRef, address indexed payer, address indexed token, uint256 amount, uint256 nonce
    );

    function setUp() public {
        intentSigner = vm.addr(SIGNER_KEY);
        vault = new DepositVault(owner, treasury, intentSigner);
        token = new MockERC20();

        vault.setAllowedToken(address(token), true);
        token.mint(payer, 1_000 ether);
    }

    /// @notice A valid signed intent transfers the exact amount and advances the payer nonce.
    /// @dev This is the core happy path for the SUT: funds move to treasury and the event carries the accounting key.
    function testDepositTransfersTokensAndConsumesNonce() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntent(SIGNER_KEY, intent);

        approveFromPayer(address(token), address(vault), intent.amount);

        vm.expectEmit(true, true, true, true, address(vault));
        emit DepositReceived(intent.paymentRef, payer, address(token), intent.amount, intent.nonce);

        vm.prank(payer);
        vault.deposit(intent, signature);

        assertEq(token.balanceOf(treasury), intent.amount);
        assertEq(token.balanceOf(payer), 900 ether);
        assertEq(vault.nonces(payer), 1);
    }

    /// @notice An intent remains valid when its deadline is exactly the current timestamp.
    /// @dev The SUT uses `block.timestamp > deadline`, so equality should not reject a backend-signed payment.
    function testAcceptsDeadlineAtCurrentTimestamp() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        intent.deadline = block.timestamp + 10;
        bytes memory signature = signIntent(SIGNER_KEY, intent);

        approveFromPayer(address(token), address(vault), intent.amount);
        vm.warp(intent.deadline);

        vm.prank(payer);
        vault.deposit(intent, signature);

        assertEq(token.balanceOf(treasury), intent.amount);
        assertEq(vault.nonces(payer), 1);
    }

    /// @notice Consecutive signed intents for the same payer settle in nonce order.
    /// @dev This proves the SUT supports normal repeated deposits while preventing gaps and replay.
    function testAcceptsSequentialNonces() external {
        DepositVault.DepositIntent memory firstIntent = defaultIntent(100 ether, 0);
        DepositVault.DepositIntent memory secondIntent = defaultIntent(50 ether, 1);
        secondIntent.paymentRef = keccak256("payment:2");

        approveFromPayer(address(token), address(vault), firstIntent.amount + secondIntent.amount);

        vm.prank(payer);
        vault.deposit(firstIntent, signIntent(SIGNER_KEY, firstIntent));

        vm.prank(payer);
        vault.deposit(secondIntent, signIntent(SIGNER_KEY, secondIntent));

        assertEq(token.balanceOf(treasury), 150 ether);
        assertEq(vault.nonces(payer), 2);
    }

    /// @notice A settled intent cannot be submitted again with the same nonce.
    /// @dev The SUT's nonce consumption is the replay barrier for reused backend signatures.
    function testRejectsReplayWithSameNonce() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntent(SIGNER_KEY, intent);

        approveFromPayer(address(token), address(vault), 200 ether);

        vm.prank(payer);
        vault.deposit(intent, signature);

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit(intent, signature);
    }

    /// @notice A signed intent with a nonce ahead of the payer's current nonce is rejected.
    /// @dev The SUT enforces strict sequencing so outstanding intents cannot be skipped.
    function testRejectsFutureNonce() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 1);

        approveFromPayer(address(token), address(vault), intent.amount);

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit(intent, signIntent(SIGNER_KEY, intent));

        assertEq(vault.nonces(payer), 0);
    }

    /// @notice Only the payer named in the signed intent may submit the deposit.
    /// @dev This preserves the SUT's no-relayer model and prevents leaked intents from being paid by another account.
    function testRejectsWrongPayer() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.WrongPayer.selector, address(0xBAD), payer));
        vm.prank(address(0xBAD));
        vault.deposit(intent, signIntent(SIGNER_KEY, intent));
    }

    /// @notice A signature from any key other than the configured backend signer is rejected.
    /// @dev The SUT must bind deposit authority to `intentSigner`, not merely to any recoverable ECDSA signer.
    function testRejectsInvalidSigner() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntent(OTHER_SIGNER_KEY, intent);
        address recovered = vm.addr(OTHER_SIGNER_KEY);

        approveFromPayer(address(token), address(vault), intent.amount);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.InvalidIntentSigner.selector, recovered));
        vm.prank(payer);
        vault.deposit(intent, signature);
    }

    /// @notice Malformed signature bytes cannot authorize a deposit.
    /// @dev The SUT delegates signature parsing to OZ ECDSA and must fail before token movement or nonce consumption.
    function testRejectsMalformedSignature() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);

        approveFromPayer(address(token), address(vault), intent.amount);

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit(intent, hex"1234");
    }

    /// @notice A signature produced for another vault cannot be replayed against this vault.
    /// @dev This verifies the SUT's EIP-712 domain binds intents to the deployed contract address.
    function testRejectsSignatureForDifferentVault() external {
        DepositVault otherVault = new DepositVault(owner, treasury, intentSigner);
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntentForVault(SIGNER_KEY, intent, address(otherVault));

        approveFromPayer(address(token), address(vault), intent.amount);

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit(intent, signature);

        assertEq(vault.nonces(payer), 0);
        assertEq(token.balanceOf(treasury), 0);
    }

    /// @notice Changing signed intent fields after signing invalidates the signature.
    /// @dev This protects the SUT from amount, token, payer, deadline, nonce, or paymentRef substitution.
    function testRejectsMutatedSignedIntent() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntent(SIGNER_KEY, intent);
        intent.amount = 101 ether;

        approveFromPayer(address(token), address(vault), intent.amount);

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit(intent, signature);

        assertEq(vault.nonces(payer), 0);
        assertEq(token.balanceOf(treasury), 0);
        assertEq(token.balanceOf(payer), 1_000 ether);
    }

    /// @notice A signed intent cannot be used after its deadline.
    /// @dev The SUT's deadline check limits stale backend authorizations and incident-response exposure.
    function testRejectsExpiredIntent() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        intent.deadline = block.timestamp + 10;
        bytes memory signature = signIntent(SIGNER_KEY, intent);

        approveFromPayer(address(token), address(vault), intent.amount);
        vm.warp(intent.deadline + 1);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ExpiredIntent.selector, intent.deadline));
        vm.prank(payer);
        vault.deposit(intent, signature);
    }

    /// @notice A deposit intent must carry a nonzero off-chain payment reference.
    /// @dev The SUT emits paymentRef for accounting, so accepting zero would create ambiguous ledger records.
    function testRejectsZeroPaymentRef() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        intent.paymentRef = bytes32(0);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroPaymentRef.selector));
        vm.prank(payer);
        vault.deposit(intent, signIntent(SIGNER_KEY, intent));
    }

    /// @notice A deposit intent must move a nonzero token amount.
    /// @dev The SUT rejects zero-value events so the off-chain ledger only sees meaningful settlements.
    function testRejectsZeroAmount() external {
        DepositVault.DepositIntent memory intent = defaultIntent(0, 0);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAmount.selector));
        vm.prank(payer);
        vault.deposit(intent, signIntent(SIGNER_KEY, intent));
    }

    /// @notice A token that has not been allowlisted cannot be deposited.
    /// @dev The SUT relies on owner-reviewed token policy before accepting transfer semantics for accounting.
    function testRejectsUnallowedToken() external {
        MockERC20 otherToken = new MockERC20();
        otherToken.mint(payer, 100 ether);

        DepositVault.DepositIntent memory intent = defaultIntentForToken(address(otherToken), 100 ether, 0);

        approveFromPayer(address(otherToken), address(vault), intent.amount);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.TokenNotAllowed.selector, address(otherToken)));
        vm.prank(payer);
        vault.deposit(intent, signIntent(SIGNER_KEY, intent));
    }

    /// @notice Removing a token from the allowlist blocks future deposits immediately.
    /// @dev This gives the SUT an operational kill switch for token incidents without rotating the whole vault.
    function testRejectsTokenAfterItIsDisabled() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);

        vault.setAllowedToken(address(token), false);
        approveFromPayer(address(token), address(vault), intent.amount);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.TokenNotAllowed.selector, address(token)));
        vm.prank(payer);
        vault.deposit(intent, signIntent(SIGNER_KEY, intent));
    }

    /// @notice A transfer failure caused by insufficient allowance leaves nonce and balances unchanged.
    /// @dev The SUT consumes the nonce before transfer, so this proves revert atomicity restores state.
    function testTransferRevertFromAllowanceDoesNotConsumeNonce() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);

        approveFromPayer(address(token), address(vault), intent.amount - 1);

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit(intent, signIntent(SIGNER_KEY, intent));

        assertEq(vault.nonces(payer), 0);
        assertEq(token.balanceOf(treasury), 0);
        assertEq(token.balanceOf(payer), 1_000 ether);
    }

    /// @notice A transfer failure caused by insufficient balance leaves nonce and balances unchanged.
    /// @dev The SUT must not burn a valid backend intent when token movement reverts.
    function testTransferRevertFromBalanceDoesNotConsumeNonce() external {
        address poorPayer = address(0xF00D);
        token.mint(poorPayer, 1 ether);

        DepositVault.DepositIntent memory intent = DepositVault.DepositIntent({
            paymentRef: keccak256("payment:poor"),
            payer: poorPayer,
            token: address(token),
            amount: 100 ether,
            nonce: 0,
            deadline: block.timestamp + 1 days
        });

        vm.prank(poorPayer);
        token.approve(address(vault), intent.amount);

        vm.expectRevert();
        vm.prank(poorPayer);
        vault.deposit(intent, signIntent(SIGNER_KEY, intent));

        assertEq(vault.nonces(poorPayer), 0);
        assertEq(token.balanceOf(treasury), 0);
        assertEq(token.balanceOf(poorPayer), 1 ether);
    }

    /// @notice Fee-on-transfer behavior is rejected even when the token is allowlisted.
    /// @dev The SUT's treasury balance-delta check prevents over-crediting the off-chain ledger.
    function testRejectsFeeOnTransferToken() external {
        FeeOnTransferERC20 feeToken = new FeeOnTransferERC20();
        feeToken.mint(payer, 100 ether);
        vault.setAllowedToken(address(feeToken), true);

        DepositVault.DepositIntent memory intent = defaultIntentForToken(address(feeToken), 100 ether, 0);

        approveFromPayer(address(feeToken), address(vault), intent.amount);

        vm.expectRevert(
            abi.encodeWithSelector(
                DepositVault.UnexpectedReceivedAmount.selector, address(feeToken), intent.amount, intent.amount - 1
            )
        );
        vm.prank(payer);
        vault.deposit(intent, signIntent(SIGNER_KEY, intent));
    }

    /// @notice A false-returning ERC-20 is rejected without consuming the payer nonce.
    /// @dev The SUT uses SafeERC20, so non-reverting false results must still fail atomically.
    function testRejectsFalseReturnTokenWithoutConsumingNonce() external {
        FalseReturnERC20 falseToken = new FalseReturnERC20();
        falseToken.mint(payer, 100 ether);
        vault.setAllowedToken(address(falseToken), true);

        DepositVault.DepositIntent memory intent = defaultIntentForToken(address(falseToken), 100 ether, 0);

        approveFromPayer(address(falseToken), address(vault), intent.amount);

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit(intent, signIntent(SIGNER_KEY, intent));

        assertEq(vault.nonces(payer), 0);
        assertEq(falseToken.balanceOf(treasury), 0);
        assertEq(falseToken.balanceOf(payer), 100 ether);
    }

    /// @notice Pausing stops deposits and unpausing restores the same signed-intent path.
    /// @dev The SUT needs an emergency brake that does not invalidate otherwise valid unpaid intents.
    function testPauseBlocksDepositsUntilUnpaused() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntent(SIGNER_KEY, intent);

        approveFromPayer(address(token), address(vault), intent.amount);
        vault.pause();

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit(intent, signature);

        vault.unpause();

        vm.prank(payer);
        vault.deposit(intent, signature);

        assertEq(token.balanceOf(treasury), intent.amount);
    }

    /// @notice Treasury rotation sends later deposits to the new treasury address.
    /// @dev The SUT should support operational treasury migration without affecting signer or payer semantics.
    function testTreasuryMigrationRoutesFutureDeposits() external {
        address newTreasury = address(0x7200);
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);

        vault.setTreasury(newTreasury);
        approveFromPayer(address(token), address(vault), intent.amount);

        vm.prank(payer);
        vault.deposit(intent, signIntent(SIGNER_KEY, intent));

        assertEq(token.balanceOf(treasury), 0);
        assertEq(token.balanceOf(newTreasury), intent.amount);
    }

    /// @notice Signer rotation immediately invalidates outstanding signatures from the old signer.
    /// @dev The SUT must let the owner respond to signer compromise without redeploying.
    function testSignerRotationInvalidatesOldSigner() external {
        address newSigner = vm.addr(OTHER_SIGNER_KEY);
        vault.setIntentSigner(newSigner);

        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);

        approveFromPayer(address(token), address(vault), intent.amount);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.InvalidIntentSigner.selector, intentSigner));
        vm.prank(payer);
        vault.deposit(intent, signIntent(SIGNER_KEY, intent));

        vm.prank(payer);
        vault.deposit(intent, signIntent(OTHER_SIGNER_KEY, intent));

        assertEq(token.balanceOf(treasury), intent.amount);
    }

    /// @notice The owner can update treasury, signer, and token allowlist policy.
    /// @dev This covers the SUT's administrative surface for routine operations.
    function testOwnerControlsPolicy() external {
        address newTreasury = address(0x7200);
        address newSigner = vm.addr(OTHER_SIGNER_KEY);

        vault.setTreasury(newTreasury);
        vault.setIntentSigner(newSigner);
        vault.setAllowedToken(address(token), false);

        assertEq(vault.treasury(), newTreasury);
        assertEq(vault.intentSigner(), newSigner);
        assertFalse(vault.allowedToken(address(token)));
    }

    /// @notice Ownership transfer requires the pending owner to accept control.
    /// @dev The SUT inherits Ownable2Step so admin authority is not moved by a one-transaction typo.
    function testOwnershipTransferIsTwoStep() external {
        address newOwner = address(0xBEEF);

        vault.transferOwnership(newOwner);

        assertEq(vault.owner(), owner);
        assertEq(vault.pendingOwner(), newOwner);

        vm.prank(newOwner);
        vault.acceptOwnership();

        assertEq(vault.owner(), newOwner);

        vm.prank(newOwner);
        vault.pause();
    }

    /// @notice Non-owners cannot change treasury, signer, allowlist, or pause state.
    /// @dev This verifies the SUT's policy controls are restricted to the current owner.
    function testRejectsNonOwnerPolicyChanges() external {
        address attacker = address(0xBAD);

        vm.expectRevert();
        vm.prank(attacker);
        vault.setTreasury(address(0x7200));

        vm.expectRevert();
        vm.prank(attacker);
        vault.setIntentSigner(vm.addr(OTHER_SIGNER_KEY));

        vm.expectRevert();
        vm.prank(attacker);
        vault.setAllowedToken(address(token), false);

        vm.expectRevert();
        vm.prank(attacker);
        vault.pause();

        vault.pause();

        vm.expectRevert();
        vm.prank(attacker);
        vault.unpause();
    }

    /// @notice Owner policy updates reject zero addresses and EOA token allowlisting.
    /// @dev The SUT guards against accidentally disabling core roles or approving non-contract tokens.
    function testRejectsUnsafePolicyValues() external {
        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAddress.selector));
        vault.setTreasury(address(0));

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAddress.selector));
        vault.setIntentSigner(address(0));

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAddress.selector));
        vault.setAllowedToken(address(0), true);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.TokenHasNoCode.selector, address(0x1234)));
        vault.setAllowedToken(address(0x1234), true);
    }

    /// @notice Deployment rejects invalid owner, treasury, and signer configuration.
    /// @dev The SUT should never start life without usable admin, payout, and authorization roles.
    function testRejectsInvalidConstructorValues() external {
        vm.expectRevert();
        new DepositVault(address(0), treasury, intentSigner);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAddress.selector));
        new DepositVault(owner, address(0), intentSigner);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAddress.selector));
        new DepositVault(owner, treasury, address(0));
    }

    /// @notice Ownership renounce is disabled permanently.
    /// @dev The SUT must retain an owner for signer rotation, treasury rotation, allowlist changes, and emergency pause.
    function testRenounceOwnershipIsDisabled() external {
        vm.expectRevert(abi.encodeWithSelector(DepositVault.RenounceDisabled.selector));
        vault.renounceOwnership();
    }

    function defaultIntent(uint256 amount, uint256 nonce) private view returns (DepositVault.DepositIntent memory) {
        return defaultIntentForToken(address(token), amount, nonce);
    }

    function defaultIntentForToken(address intentToken, uint256 amount, uint256 nonce)
        private
        view
        returns (DepositVault.DepositIntent memory)
    {
        return DepositVault.DepositIntent({
            paymentRef: keccak256("payment:1"),
            payer: payer,
            token: intentToken,
            amount: amount,
            nonce: nonce,
            deadline: block.timestamp + 1 days
        });
    }

    function approveFromPayer(address approvedToken, address spender, uint256 amount) private {
        vm.prank(payer);
        MockERC20(approvedToken).approve(spender, amount);
    }

    function signIntent(uint256 privateKey, DepositVault.DepositIntent memory intent) private returns (bytes memory) {
        return signIntentForVault(privateKey, intent, address(vault));
    }

    function signIntentForVault(uint256 privateKey, DepositVault.DepositIntent memory intent, address verifyingVault)
        private
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                DEPOSIT_INTENT_TYPEHASH,
                intent.paymentRef,
                intent.payer,
                intent.token,
                intent.amount,
                intent.nonce,
                intent.deadline
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("DepositVault")),
                keccak256(bytes("1")),
                block.chainid,
                verifyingVault
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);

        return abi.encodePacked(r, s, v);
    }

    function assertEq(uint256 actual, uint256 expected) private pure {
        if (actual != expected) {
            revert("uint mismatch");
        }
    }

    function assertEq(address actual, address expected) private pure {
        if (actual != expected) {
            revert("address mismatch");
        }
    }

    function assertFalse(bool value) private pure {
        if (value) {
            revert("expected false");
        }
    }
}
