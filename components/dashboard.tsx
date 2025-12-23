"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@crossmint/client-sdk-react-ui";
import Image from "next/image";
import { TransferFunds } from "./transfer";
import { Activity } from "./activity";
import { Footer } from "./footer";
import { LogoutButton } from "./logout";
import { WalletBalance } from "./balance";
import { cn } from "@/lib/utils";

export function Dashboard() {
  const { wallet } = useWallet();
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [isUserEditorOpen, setIsUserEditorOpen] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [isLoadingUser, setIsLoadingUser] = useState(false);
  const [userFormError, setUserFormError] = useState<string | null>(null);
  const [userFormSuccess, setUserFormSuccess] = useState<string | null>(null);
  const [userForm, setUserForm] = useState({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    countryOfResidence: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    email: "",
    phoneNumber: "",
    idType: "passport",
    idNumber: "",
    employmentStatus: "",
    sourceOfFunds: "",
    industry: "",
    idVerificationTimestamp: "",
    livenessVerificationTimestamp: "",
  });

  const walletAddress = wallet?.address;
  const userLocator = wallet?.owner ?? "";

  const handleCopyAddress = async () => {
    if (!walletAddress) return;
    if (typeof navigator === "undefined" || !navigator?.clipboard?.writeText) {
      console.error("Clipboard API not available");
      return;
    }
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleUserFieldChange = (
    field: keyof typeof userForm,
    value: string
  ) => {
    setUserForm((prev) => ({ ...prev, [field]: value }));
  };

  const toIsoString = (value: string) =>
    value ? new Date(value).toISOString() : "";

  const handleSaveUser = async () => {
    if (!userLocator) {
      setUserFormError("User locator is unavailable.");
      return;
    }

    setUserFormError(null);
    setUserFormSuccess(null);

    const payload: Record<string, unknown> = {};

    const hasAnyUserDetails =
      userForm.firstName ||
      userForm.lastName ||
      userForm.dateOfBirth ||
      userForm.countryOfResidence;
    if (hasAnyUserDetails) {
      if (
        !userForm.firstName ||
        !userForm.lastName ||
        !userForm.dateOfBirth ||
        !userForm.countryOfResidence
      ) {
        setUserFormError("Complete all required user details fields.");
        return;
      }
      payload.userDetails = {
        firstName: userForm.firstName.trim(),
        lastName: userForm.lastName.trim(),
        dateOfBirth: userForm.dateOfBirth,
        countryOfResidence: userForm.countryOfResidence.trim().toUpperCase(),
      };
    }

    const hasAnyAddress =
      userForm.addressLine1 ||
      userForm.city ||
      userForm.state ||
      userForm.postalCode ||
      userForm.addressLine2;
    const hasAnyIdentity = userForm.idNumber || userForm.idType;
    const hasAnyKyc =
      hasAnyAddress ||
      hasAnyIdentity ||
      userForm.email ||
      userForm.phoneNumber;
    if (hasAnyKyc) {
      if (
        !userForm.addressLine1 ||
        !userForm.city ||
        !userForm.state ||
        !userForm.postalCode ||
        !userForm.idType ||
        !userForm.idNumber
      ) {
        setUserFormError("Complete all required KYC fields.");
        return;
      }
      payload.kycData = {
        addressOfResidence: {
          line1: userForm.addressLine1.trim(),
          line2: userForm.addressLine2.trim() || undefined,
          city: userForm.city.trim(),
          state: userForm.state.trim(),
          postalCode: userForm.postalCode.trim(),
        },
        email: userForm.email.trim() || undefined,
        phoneNumber: userForm.phoneNumber.trim() || undefined,
        identityDocument: {
          type: userForm.idType,
          number: userForm.idNumber.trim(),
        },
      };
    }

    const hasAnyDueDiligence =
      userForm.employmentStatus ||
      userForm.sourceOfFunds ||
      userForm.industry;
    if (hasAnyDueDiligence) {
      if (
        !userForm.employmentStatus ||
        !userForm.sourceOfFunds ||
        !userForm.industry
      ) {
        setUserFormError("Complete all required due diligence fields.");
        return;
      }
      payload.dueDiligence = {
        employmentStatus: userForm.employmentStatus,
        sourceOfFunds: userForm.sourceOfFunds,
        industry: userForm.industry,
      };
    }

    const hasAnyVerification =
      userForm.idVerificationTimestamp ||
      userForm.livenessVerificationTimestamp;
    if (hasAnyVerification) {
      if (
        !userForm.idVerificationTimestamp ||
        !userForm.livenessVerificationTimestamp
      ) {
        setUserFormError("Complete both verification timestamps.");
        return;
      }
      payload.verificationHistory = {
        idVerificationTimestamp: toIsoString(
          userForm.idVerificationTimestamp
        ),
        livenessVerificationTimestamp: toIsoString(
          userForm.livenessVerificationTimestamp
        ),
      };
    }

    if (Object.keys(payload).length === 0) {
      setUserFormError("Fill in at least one section before saving.");
      return;
    }

    setIsSavingUser(true);
    try {
      const res = await fetch(
        `/api/users/${encodeURIComponent(userLocator)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        const message =
          data?.details?.message || data?.error || "Failed to update user.";
        setUserFormError(message);
        return;
      }
      setUserFormSuccess("User details saved.");
    } catch (error) {
      setUserFormError("Failed to update user.");
    } finally {
      setIsSavingUser(false);
    }
  };

  useEffect(() => {
    if (!isUserEditorOpen || !userLocator) {
      return;
    }

    const fetchUser = async () => {
      setIsLoadingUser(true);
      setUserFormError(null);
      setUserFormSuccess(null);
      try {
        const res = await fetch(
          `/api/users/${encodeURIComponent(userLocator)}`
        );
        const data = await res.json();
        if (!res.ok) {
          const message =
            data?.details?.message || data?.error || "Failed to fetch user.";
          setUserFormError(message);
          return;
        }
        const details = data?.userDetails ?? {};
        const kyc = data?.kycData ?? {};
        const address = kyc?.addressOfResidence ?? {};
        const identity = kyc?.identityDocument ?? {};
        const due = data?.dueDiligence ?? {};
        const verification = data?.verificationHistory ?? {};
        setUserForm({
          firstName: details.firstName ?? "",
          lastName: details.lastName ?? "",
          dateOfBirth: details.dateOfBirth ?? "",
          countryOfResidence: details.countryOfResidence ?? "",
          addressLine1: address.line1 ?? "",
          addressLine2: address.line2 ?? "",
          city: address.city ?? "",
          state: address.state ?? "",
          postalCode: address.postalCode ?? "",
          email: kyc.email ?? "",
          phoneNumber: kyc.phoneNumber ?? "",
          idType: identity.type ?? "passport",
          idNumber: identity.number ?? "",
          employmentStatus: due.employmentStatus ?? "",
          sourceOfFunds: due.sourceOfFunds ?? "",
          industry: due.industry ?? "",
          idVerificationTimestamp: verification.idVerificationTimestamp ?? "",
          livenessVerificationTimestamp:
            verification.livenessVerificationTimestamp ?? "",
        });
      } catch (error) {
        setUserFormError("Failed to fetch user.");
      } finally {
        setIsLoadingUser(false);
      }
    };

    fetchUser();
  }, [isUserEditorOpen, userLocator]);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="w-full max-w-6xl mx-auto px-4 py-10 flex flex-col gap-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-center gap-4">
              <Image
                src="/finyx.svg"
                alt="Finyx logo"
                priority
                width={160}
                height={60}
                className="h-12 w-auto"
              />
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
                  Wallet Studio
                </p>
                <h1 className="text-3xl font-semibold text-slate-900">
                  Designed for the Finyx community
                </h1>
              </div>
            </div>
            <div className="text-right text-sm text-slate-500">
              <p className="text-slate-400">Connected chain</p>
              <p className="text-lg font-semibold text-slate-900">
                {wallet?.chain ?? "Unknown"}
              </p>
            </div>
          </div>
          <p className="text-sm text-slate-500 max-w-2xl">
            Finyx Wallet Studio wraps Crossmint's wallet primitives with bright
            gradients, bold typography, and frictionless flows.
          </p>
        </section>

        <section className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">Dashboard</h2>
              <p className="text-sm text-slate-500">
                Wallet overview and instant actions
              </p>
            </div>
            <LogoutButton />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="flex flex-col gap-6">
              <div className="bg-[#1c2c56] border border-white/15 p-6 rounded-3xl shadow-lg">
                <WalletBalance />
              </div>
              <div className="bg-[#1c2c56] border border-white/15 p-6 rounded-3xl shadow-lg space-y-4">
                <h3 className="text-lg font-semibold text-white">Wallet details</h3>
                <div className="flex flex-col gap-3 text-sm text-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Address</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-100">
                        {walletAddress
                          ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-6)}`
                          : "Not connected"}
                      </span>
                      <button
                        onClick={handleCopyAddress}
                        className="text-slate-300 hover:text-white transition"
                      >
                        {copiedAddress ? (
                          <Image
                            src="/circle-check-big.svg"
                            alt="Copied"
                            width={16}
                            height={16}
                          />
                        ) : (
                          <Image src="/copy.svg" alt="Copy" width={16} height={16} />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Owner</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-100">
                        {wallet?.owner?.replace(/^[^:]*:/, "") ||
                          "Current User"}
                      </span>
                      {/* <button
                        onClick={() => {
                          if (!userLocator) {
                            setUserFormError(
                              "User locator is unavailable for this wallet."
                            );
                            setIsUserEditorOpen(true);
                            return;
                          }
                          setIsUserEditorOpen(true);
                        }}
                        disabled={!userLocator}
                        className={cn(
                          "text-slate-300 hover:text-white transition",
                          !userLocator && "cursor-not-allowed opacity-50"
                        )}
                        aria-label="Edit owner"
                      >
                        <Image src="/window.svg" alt="Edit" width={16} height={16} />
                      </button> */}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Chain</span>
                    <span className="text-slate-100 capitalize">
                      {wallet?.chain ?? "Unknown"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="lg:col-span-1">
              <TransferFunds />
            </div>
            <div className="lg:col-span-1">
              <Activity />
            </div>
          </div>
        </section>
      </div>
      {isUserEditorOpen ? (
        <div
          className="fixed inset-0 z-50 flex justify-center bg-black/60 px-4 py-10 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-2xl my-auto">
            <div className="rounded-3xl border border-white/10 bg-[#0b1324] text-white shadow-[0_30px_80px_rgba(3,7,18,0.45)] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
                <div>
                  <h1 className="text-base font-semibold">Edit user</h1>
                  <p className="text-[11px] text-white/60">
                    Update Crossmint user details and KYC data.
                  </p>
                </div>
                <button
                  onClick={() => setIsUserEditorOpen(false)}
                  className="text-[11px] font-semibold text-white/70 hover:text-white"
                >
                  Close
                </button>
              </div>
              <div className="p-5 space-y-4">
                {!userLocator ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/80">
                    User locator is unavailable.
                  </div>
                ) : isLoadingUser ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/80">
                    Loading user details...
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-3">
                  <h2 className="text-xs font-semibold text-white/80">
                    User details
                  </h2>
                  <input
                    type="text"
                    placeholder="First name"
                    value={userForm.firstName}
                    onChange={(e) =>
                      handleUserFieldChange("firstName", e.target.value)
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  />
                  <input
                    type="text"
                    placeholder="Last name"
                    value={userForm.lastName}
                    onChange={(e) =>
                      handleUserFieldChange("lastName", e.target.value)
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  />
                  <input
                    type="date"
                    value={userForm.dateOfBirth}
                    onChange={(e) =>
                      handleUserFieldChange("dateOfBirth", e.target.value)
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  />
                  <input
                    type="text"
                    placeholder="Country of residence (ISO2)"
                    value={userForm.countryOfResidence}
                    onChange={(e) =>
                      handleUserFieldChange("countryOfResidence", e.target.value)
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <h2 className="text-xs font-semibold text-white/80">
                    KYC data
                  </h2>
                  <input
                    type="text"
                    placeholder="Address line 1"
                    value={userForm.addressLine1}
                    onChange={(e) =>
                      handleUserFieldChange("addressLine1", e.target.value)
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  />
                  <input
                    type="text"
                    placeholder="Address line 2"
                    value={userForm.addressLine2}
                    onChange={(e) =>
                      handleUserFieldChange("addressLine2", e.target.value)
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="City"
                      value={userForm.city}
                      onChange={(e) =>
                        handleUserFieldChange("city", e.target.value)
                      }
                      className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                    />
                    <input
                      type="text"
                      placeholder="State"
                      value={userForm.state}
                      onChange={(e) =>
                        handleUserFieldChange("state", e.target.value)
                      }
                      className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Postal code"
                    value={userForm.postalCode}
                    onChange={(e) =>
                      handleUserFieldChange("postalCode", e.target.value)
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    value={userForm.email}
                    onChange={(e) =>
                      handleUserFieldChange("email", e.target.value)
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  />
                  <input
                    type="tel"
                    placeholder="Phone number"
                    value={userForm.phoneNumber}
                    onChange={(e) =>
                      handleUserFieldChange("phoneNumber", e.target.value)
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <select
                      value={userForm.idType}
                      onChange={(e) =>
                        handleUserFieldChange("idType", e.target.value)
                      }
                      className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                    >
                      <option value="passport">Passport</option>
                      <option value="id">ID</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Document number"
                      value={userForm.idNumber}
                      onChange={(e) =>
                        handleUserFieldChange("idNumber", e.target.value)
                      }
                      className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <h2 className="text-xs font-semibold text-white/80">
                    Due diligence
                  </h2>
                  <select
                    value={userForm.employmentStatus}
                    onChange={(e) =>
                      handleUserFieldChange("employmentStatus", e.target.value)
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  >
                    <option value="">Employment status</option>
                    <option value="contractual">Contractual</option>
                    <option value="full-time">Full-time</option>
                    <option value="part-time">Part-time</option>
                    <option value="retired">Retired</option>
                    <option value="self-employed">Self-employed</option>
                    <option value="student">Student</option>
                    <option value="unemployed">Unemployed</option>
                  </select>
                  <select
                    value={userForm.sourceOfFunds}
                    onChange={(e) =>
                      handleUserFieldChange("sourceOfFunds", e.target.value)
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  >
                    <option value="">Source of funds</option>
                    <option value="employment-income">Employment income</option>
                    <option value="investments-gains">Investments gains</option>
                    <option value="business-dividends-profits">
                      Business dividends/profits
                    </option>
                    <option value="real-estate">Real estate</option>
                    <option value="inheritance">Inheritance</option>
                    <option value="savings-personal-funds">
                      Savings/personal funds
                    </option>
                    <option value="loan-disbursement">Loan disbursement</option>
                    <option value="government-benefits">
                      Government benefits
                    </option>
                    <option value="other">Other</option>
                  </select>
                  <select
                    value={userForm.industry}
                    onChange={(e) =>
                      handleUserFieldChange("industry", e.target.value)
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  >
                    <option value="">Industry</option>
                    <option value="blockchain">Blockchain</option>
                    <option value="finance-insurance">Finance/Insurance</option>
                    <option value="investment">Investment</option>
                    <option value="crypto">Crypto</option>
                    <option value="student">Student</option>
                    <option value="unemployed">Unemployed</option>
                    <option value="other-services">Other services</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <h2 className="text-xs font-semibold text-white/80">
                    Verification history
                  </h2>
                  <input
                    type="datetime-local"
                    value={userForm.idVerificationTimestamp}
                    onChange={(e) =>
                      handleUserFieldChange(
                        "idVerificationTimestamp",
                        e.target.value
                      )
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  />
                  <input
                    type="datetime-local"
                    value={userForm.livenessVerificationTimestamp}
                    onChange={(e) =>
                      handleUserFieldChange(
                        "livenessVerificationTimestamp",
                        e.target.value
                      )
                    }
                    className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-[#ffac44]"
                  />
                </div>

                {userFormError ? (
                  <p className="text-[11px] text-red-200">{userFormError}</p>
                ) : null}
                {userFormSuccess ? (
                  <p className="text-[11px] text-green-200">
                    {userFormSuccess}
                  </p>
                ) : null}

                <button
                  onClick={handleSaveUser}
                  disabled={isSavingUser || !userLocator}
                  className={cn(
                    "w-full py-2 rounded-full text-xs font-semibold transition-all duration-200",
                    isSavingUser || !userLocator
                      ? "bg-white/20 text-white/60 cursor-not-allowed"
                      : "bg-white text-[#041126] hover:opacity-90"
                  )}
                >
                  {isSavingUser ? "Saving..." : "Save user"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <Footer />
    </div>
  );
}
