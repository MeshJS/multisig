/**
 * Gets the Discord user's avatar URL using their Discord ID
 * @param discordId The Discord user ID
 * @returns The URL to the user's avatar
 */
export default async function getDiscordAvatar(
  discordId: string,
): Promise<string> {
  try {
    // Make a request to our API endpoint
    const response = await fetch(
      `/api/discord/get-user?discordId=${discordId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      console.error("Failed to fetch Discord user");
      // Return a default avatar if we can't fetch the user's avatar
      return `https://cdn.discordapp.com/embed/avatars/0.png`;
    }

    const data = await response.json();

    // If the user has a custom avatar, construct the avatar URL
    if (data.avatar) {
      // Determine if the avatar is animated (starts with 'a_')
      const extension = data.avatar.startsWith("a_") ? "gif" : "png";
      return `https://cdn.discordapp.com/avatars/${discordId}/${data.avatar}.${extension}`;
    }

    // If no custom avatar, return the default avatar based on discriminator
    // Discord's default avatars are numbered 0-4 based on the user's discriminator % 5
    const defaultAvatarNumber = (parseInt(data.discriminator) || 0) % 5;
    return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarNumber}.png`;
  } catch (error) {
    console.error("Error fetching Discord avatar:", error);
    // Return a default avatar in case of error
    return `https://cdn.discordapp.com/embed/avatars/0.png`;
  }
}
