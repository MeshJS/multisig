import { buildWallet } from "../utils/common";
import { Wallet as DbWallet } from "@prisma/client";
import { RawImportBodies } from "../types/wallet";

describe("Summon Wallet Capabilities", () => {
    const network = 0; // Testnet

    const mockSummonWallet: DbWallet & { rawImportBodies: RawImportBodies } = {
        id: "test-summon-uuid",
        name: "Test Summon Wallet",
        description: "A test summon wallet",
        address: "addr_test1wpnlxv2xv988tvv9z06m6pax76r98slymr6uzy958tclv6sgp98k8",
        type: "atLeast",
        numRequiredSigners: 2,
        signersAddresses: ["addr_test1vpu5vl76u73su6p0657cw6q0657cw6q0657cw6q0657cw6q0657cw"],
        signersStakeKeys: [],
        signersDRepKeys: [],
        scriptCbor: "8201828200581caf000000000000000000000000000000000000000000000000000000008200581cb0000000000000000000000000000000000000000000000000000000",
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        profileImageIpfsUrl: null,
        stakeCredentialHash: null,
        dRepId: "",
        rawImportBodies: {
            multisig: {
                address: "addr_test1wpnlxv2xv988tvv9z06m6pax76r98slymr6uzy958tclv6sgp98k8",
                payment_script: "8200581c00000000000000000000000000000000000000000000000000000000",
                stake_script: "8200581c11111111111111111111111111111111111111111111111111111111",
            }
        }
    } as any;

    it("should correctly populate capabilities for a Summon wallet with staking", () => {
        const wallet = buildWallet(mockSummonWallet, network);

        expect(wallet.capabilities).toBeDefined();
        expect(wallet.capabilities!.canStake).toBe(true);
        expect(wallet.capabilities!.canVote).toBe(false);
        expect(wallet.capabilities!.address).toBe(mockSummonWallet.rawImportBodies.multisig!.address);
        expect(wallet.capabilities!.stakeAddress).toBeDefined();
        expect(wallet.capabilities!.stakeAddress).toMatch(/^stake_test/);
    });

    it("should correctly populate capabilities for a Summon wallet without staking", () => {
        const mockNoStake = {
            ...mockSummonWallet,
            rawImportBodies: {
                multisig: {
                    ...mockSummonWallet.rawImportBodies.multisig,
                    stake_script: undefined
                }
            }
        };
        const wallet = buildWallet(mockNoStake, network);

        expect(wallet.capabilities!.canStake).toBe(false);
        expect(wallet.capabilities!.stakeAddress).toBeUndefined();
    });
});
