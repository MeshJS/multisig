import React from "react";
import { cn } from "@/lib/utils";
import Image from "next/image";

export function PageFeature() {
  const features = [
    {
      title: "Manage all your wallets",
      description:
        "Multisig wallets for every collaboration, project, or team you are part of.",
      skeleton: <Skeleton image={"/features/multi-wallets.png"} />,
      className: "lg:col-span-3",
    },
    {
      title: "Invite signers",
      description:
        "Invite signers to your multisig wallet by simply sharing a link.",
      skeleton: <Skeleton image={"/features/invite-signers.png"} />,
      className: "lg:col-span-3",
    },
    {
      title: "Create new transactions",
      description:
        "Intuitive interface to create new transactions and send to required signers for signatures.",
      skeleton: <Skeleton image={"/features/new-tx.png"} />,
      className: "lg:col-span-2",
    },
    {
      title: "Pending transactions",
      description:
        "Required signers can view and approve pending transactions with ease.",
      skeleton: <Skeleton image={"/features/pending-tx.png"} />,
      className: "lg:col-span-4",
    },
    {
      title: "One view for all transactions",
      description:
        "View all your transactions in one place, including who signed it and the transaction's purpose.",
      skeleton: <Skeleton image={"/features/all-tx.png"} />,
      className: "lg:col-span-4",
    },

    {
      title: "Register DRep",
      description: "Register your team as one Delegated Representative.",
      skeleton: <Skeleton image={"/features/register-drep.png"} />,
      className: "lg:col-span-2",
    },
    {
      title: "Participate in governance",
      description: "View all Cardano proposals and vote as a team.",
      skeleton: <Skeleton image={"/features/proposals.png"} />,
      className: "lg:col-span-3",
    },
    {
      title: "Chat and collaborate",
      description: "Chat with team about managing transactions and governance.",
      skeleton: <Skeleton image={"/features/chat.png"} />,
      className: "lg:col-span-3",
    },
    {
      title: "Verify signers",
      description:
        "Ensure all your signers are verified and have access to the wallet.",
      skeleton: <Skeleton image={"/features/verify-signers.png"} />,
      className: "lg:col-span-3",
    },
  ];

  return (
    <div className="relative z-20 mx-auto max-w-7xl py-10 lg:py-8">
      <div className="px-8">
        <h4 className="mx-auto max-w-5xl text-center text-3xl font-medium tracking-tight text-black dark:text-white lg:text-5xl lg:leading-tight">
          Packed with Features
        </h4>
        <p className="mx-auto my-4 max-w-2xl text-center text-sm font-normal text-neutral-500 dark:text-neutral-300 lg:text-base">
          Secure your treasury and participant in governance, as a team with
          multi-signature
        </p>
      </div>

      <div className="relative">
        <div className="mt-12 grid grid-cols-1 rounded-md dark:border-neutral-800 lg:grid-cols-6 xl:border">
          {features.map((feature) => (
            <FeatureCard
              key={feature.title}
              className={`col-span-1 border dark:border-neutral-800 ${feature.className}`}
            >
              <FeatureTitle>{feature.title}</FeatureTitle>
              <FeatureDescription>{feature.description}</FeatureDescription>
              <div className="h-full w-full">{feature.skeleton}</div>
            </FeatureCard>
          ))}
        </div>
      </div>
    </div>
  );
}

const FeatureCard = ({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn(`relative overflow-hidden p-4 sm:p-8`, className)}>
      {children}
    </div>
  );
};

const FeatureTitle = ({ children }: { children?: React.ReactNode }) => {
  return (
    <p className="mx-auto max-w-5xl text-left text-xl tracking-tight text-black dark:text-white md:text-2xl md:leading-snug">
      {children}
    </p>
  );
};

const FeatureDescription = ({ children }: { children?: React.ReactNode }) => {
  return (
    <p
      className={cn(
        "mx-auto max-w-4xl text-left text-sm md:text-base",
        "text-center font-normal text-neutral-500 dark:text-neutral-300",
        "mx-0 my-2 max-w-sm text-left md:text-sm",
      )}
    >
      {children}
    </p>
  );
};

function Skeleton({ image }: { image: string }) {
  return (
    <>
      <div className="group mx-auto h-full w-full p-5 shadow-2xl">
        <div className="flex h-full w-full flex-1 flex-col space-y-2">
          <Image
            src={image}
            alt={image}
            width={800}
            height={800}
            className="h-full w-full object-contain"
          />
        </div>
      </div>
      {/* <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 h-60 w-full bg-gradient-to-t from-white via-white to-transparent dark:from-black dark:via-black" /> */}
      {/* <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-60 w-full bg-gradient-to-b from-white via-transparent to-transparent dark:from-black" /> */}
    </>
  );
}
