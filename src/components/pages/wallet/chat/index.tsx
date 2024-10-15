import Button from "@/components/common/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import useAppWallet from "@/hooks/useAppWallet";
import useUser from "@/hooks/useUser";
import { useNostrChat } from "@jinglescode/nostr-chat-plugin";
import { CornerDownLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/utils/api";
import { AnimatePresence, motion } from "framer-motion";

export default function WalletChat() {
  const { appWallet } = useAppWallet();
  const { user } = useUser();
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [pubkey, setPubkey] = useState<string | undefined>(undefined);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [textareaValue, setTextareaValue] = useState<string>("");
  const [usersPubkeyToName, setUsersPubkeyToName] = useState<
    {
      pubkey: any;
      address: string;
      name: string | undefined;
    }[]
  >([]);

  const { data: nostrUsers } = api.user.getNostrKeysByAddresses.useQuery(
    {
      addresses: appWallet ? appWallet.signersAddresses : [],
    },
    {
      enabled: appWallet !== undefined,
    },
  );

  const { subscribeRoom, messages, publishMessage, setUser, roomId } =
    useNostrChat();

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    async function load() {
      if (appWallet && roomId != appWallet.id && !connecting) {
        setConnecting(true);
        subscribeRoom(appWallet.id);
      }
    }
    load();
  }, [appWallet]);

  useEffect(() => {
    if (user && appWallet && nostrUsers && usersPubkeyToName.length === 0) {
      const _nostrUsers = nostrUsers.map((user) => {
        return {
          pubkey: JSON.parse(user.nostrKey).pubkey,
          address: user.address,
          name: appWallet.signersDescriptions[
            appWallet.signersAddresses.indexOf(user.address)
          ],
        };
      });
      setUsersPubkeyToName(_nostrUsers);

      const { nsec, pubkey } = JSON.parse(user.nostrKey);
      setPubkey(pubkey);
      setUser({ nsec, pubkey });
    }
  }, [user, appWallet, nostrUsers]);

  function handleSend() {
    publishMessage(textareaValue);
    setTextareaValue("");
  }

  const handleKeyPress = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      setTextareaValue((prev) => prev + "\n");
    }
  };

  if (appWallet === undefined) return <></>;
  return (
    <main className="flex h-[calc(100vh-60px)] flex-1 flex-col gap-4 md:gap-8">
      <div className="relative flex h-full min-h-[50vh] flex-col rounded-xl bg-muted/50 p-4 lg:col-span-2">
        <div
          className="flex flex-col gap-2 overflow-y-auto pr-2"
          ref={messagesContainerRef}
        >
          <AnimatePresence>
            {messages &&
              messages
                .sort((a, b) => a.timestamp - b.timestamp)
                .map((msg) => (
                  <motion.div
                    key={msg.id}
                    layout
                    initial={{ opacity: 0, scale: 1, y: 50, x: 0 }}
                    animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
                    exit={{ opacity: 0, scale: 1, y: 1, x: 0 }}
                    transition={{
                      opacity: { duration: 0.1 },
                      layout: {
                        type: "spring",
                        bounce: 0.3,
                        duration: messages.indexOf(msg) * 0.05 + 0.2,
                      },
                    }}
                    style={{
                      originX: 0.5,
                      originY: 0.5,
                    }}
                    className={`mb-2 max-w-xs rounded-lg p-2 ${
                      msg.pubkey === pubkey
                        ? "self-end bg-blue-500 text-white"
                        : "self-start bg-gray-800"
                    }`}
                  >
                    <div className="flex gap-2">
                      {usersPubkeyToName.find((u) => u.pubkey === msg.pubkey)
                        ?.name && (
                        <p className="text-xs">
                          {
                            usersPubkeyToName.find(
                              (u) => u.pubkey === msg.pubkey,
                            )?.name
                          }
                        </p>
                      )}
                    </div>
                    <pre>{msg.message}</pre>
                    <p className="text-xs text-gray-300">
                      {new Date(msg.timestamp * 1000).toLocaleString("en-US", {
                        weekday: "short",
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </motion.div>
                ))}
          </AnimatePresence>
        </div>

        <div className="flex-1" />
        <form
          className="relative overflow-hidden rounded-lg border bg-background focus-within:ring-1 focus-within:ring-ring"
          x-chunk="dashboard-03-chunk-1"
        >
          <Label htmlFor="message" className="sr-only">
            Message
          </Label>
          <Textarea
            id="message"
            placeholder="Type your message here..."
            className="min-h-12 resize-none border-0 p-3 shadow-none focus-visible:ring-0"
            value={textareaValue}
            onChange={(e) => setTextareaValue(e.target.value)}
            onKeyDown={handleKeyPress}
          />
          <div className="flex items-center p-3 pt-0">
            {/* <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Paperclip className="size-4" />
                      <span className="sr-only">Attach file</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Attach File</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Mic className="size-4" />
                      <span className="sr-only">Use Microphone</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Use Microphone</TooltipContent>
                </Tooltip> */}
            <Button
              size="sm"
              className="ml-auto gap-1.5"
              disabled={textareaValue.length < 1}
              onClick={() => {
                publishMessage(textareaValue);
                setTextareaValue("");
              }}
            >
              Send Message
              <CornerDownLeft className="size-3.5" />
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
