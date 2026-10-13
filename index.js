import { Client, GatewayIntentBits, ActivityType } from "discord.js";
import { GoogleGenAI } from "@google/genai";
import express from "express";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot sa AI memorijom je aktivan!"));
app.listen(PORT, () => console.log("Server started..."));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// LOGOVANJE I POSTAVLJANJE ONLINE STATUS-A
client.once("clientReady", (readyClient) => {
  console.log(
    `🤖 Bot je uspešno pokrenut i ulogovan kao: ${readyClient.user.tag}`,
  );

  //   // Eksplicitno postavljanje statusa na 'online' i dodavanje aktivnosti (opciono)
  //   readyClient.user.setPresence({
  //     status: "online", // 'online', 'idle', 'dnd', 'invisible'
  //     activities: [
  //       {
  //         name: "za tvoja pitanja | @me",
  //         type: ActivityType.Watching,
  //       },
  //     ],
  //   });

  //   readyClient.user.setStatus("online");
});

// Mapa za čuvanje istorije po ID-ju kanala (channelId -> array poruka)
const channelHistories = new Map();

// Maksimalan broj poruka koje čuvamo u istoriji po kanalu (da ne preopteretimo prompt)
const MAX_HISTORY_LENGTH = 10;

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user);

  if (isMentioned) {
    let typingInterval = null;

    try {
      // 1. Odmah pošalji prvi typing signal
      await message.channel.sendTyping();

      // 2. Pokreni interval koji obnavlja typing status na svakih 5 sekundi
      typingInterval = setInterval(() => {
        message.channel.sendTyping().catch(() => {});
      }, 5000);

      const cleanPrompt = message.content
        .replace(`<@${client.user.id}>`, "")
        .trim();

      // Komanda za resetovanje memorije u kanalu
      if (cleanPrompt.toLowerCase() === "reset") {
        channelHistories.delete(message.channel.id);
        return message.reply(
          "Zaboravio sam naš prethodni razgovor u ovom kanalu!",
        );
      }

      if (!cleanPrompt)
        return message.reply("Reci mi, kako mogu da ti pomognem?");

      const channelId = message.channel.id;

      // Ako ne postoji istorija za ovaj kanal, inicijalizujemo prazan niz
      if (!channelHistories.has(channelId)) {
        channelHistories.set(channelId, []);
      }

      const history = channelHistories.get(channelId);

      // Sastavljamo kompletne poruke (istorija + nova poruka) za Gemini API
      const contents = [
        ...history,
        { role: "user", parts: [{ text: cleanPrompt }] },
      ];

      // Pozivamo Gemini sa celokupnim kontekstom
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: contents,
        config: {
          systemInstruction:
            "Ti si koristan Discord asistent koji pamti prethodni tok razgovora sa korisnicima.",
        },
      });

      const replyText = response.text;

      // Dodajemo trenutno pitanje i AI odgovor u lokalnu istoriju kanala
      history.push({ role: "user", parts: [{ text: cleanPrompt }] });
      history.push({ role: "model", parts: [{ text: replyText }] });

      // Ako istorija pređe definisanu granicu, izbacujemo najstariji par (user + model)
      if (history.length > MAX_HISTORY_LENGTH * 2) {
        history.splice(0, 2);
      }

      // Slanje odgovora na Discord
      if (replyText.length > 2000) {
        await message.reply(replyText.substring(0, 1990) + "...");
      } else {
        await message.reply(replyText);
      }
    } catch (error) {
      console.error("Greška:", error);
      await message.reply("Došlo je do greške prilikom obrade zahteva.");
    } finally {
      // 3. KLJUČNO: Zaustavljamo interval čim se obrada završi (uspešno ili uz grešku)
      if (typingInterval) {
        clearInterval(typingInterval);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
