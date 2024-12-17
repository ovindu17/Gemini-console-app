const axios = require("axios");
const readline = require("readline");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { google } = require("googleapis");
const fetch = require("node-fetch");
const e = require("express");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

//demo functionality
async function setLightValues(brightness, colorTemperature) {
  return {
    brightness,
    colorTemperature,
  };
}

//demo functionality
async function setRoomTemperature(temperature) {
  return {
    temperature,
  };
}

async function getEmails(searchQuery) {
  let url = "http://localhost:3001/getemails";
  if (searchQuery) {
    url += `?query=${encodeURIComponent(searchQuery)}`;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Network response was not ok");
  }
  const emails = await response.json();
  return emails;
}



const controlLightFunctionDeclaration = {
  name: "controlLight",
  parameters: {
    type: "OBJECT",
    description: "Set the brightness and color temperature of a room light.",
    properties: {
      brightness: {
        type: "NUMBER",
      },
      colorTemperature: {
        type: "STRING",
      },
    },
    required: ["brightness", "colorTemperature"],
  },
};

const setRoomTemperatureFunctionDeclaration = {
  name: "setRoomTemperature",
  parameters: {
    type: "OBJECT",
    description: "Set the room temperature.",
    properties: {
      temperature: {
        type: "NUMBER",
      },
    },
    required: ["temperature"],
  },
};

const getEmailsFunctionDeclaration = {
  name: "getEmails",
  parameters: {
    type: "OBJECT",
    description: "Fetches emails from Gmail inbox based on the search query.",
    properties: {
      searchQuery: {
        type: "STRING",
        description: "The search query to filter emails",
      },
    },
    required: ["searchQuery"],
  },
};



const functions = {
  controlLight: async ({ brightness, colorTemperature }) => {
    return await setLightValues(brightness, colorTemperature);
  },
  setRoomTemperature: async ({ temperature }) => {
    return await setRoomTemperature(temperature);
  },
  getEmails: async ({ searchQuery }) => {
    const emails = await getEmails(searchQuery);
    return {
      emails: emails.map((email) => ({
        from: email.from,
        subject: email.subject,
        date: email.date,
        snippet: email.snippet,
      })),
    };
  },
  
};

const genAI = new GoogleGenerativeAI("Your API Key");
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash-001",
  systemInstruction:
    "any intructions how the the model should behave",
  tools: {
    functionDeclarations: [
      controlLightFunctionDeclaration,
      setRoomTemperatureFunctionDeclaration,
      getEmailsFunctionDeclaration,
    ],
  },
});

const chat = model.startChat();
async function functionCalling(prompt) {
  try {
    const res = await chat.sendMessageStream(prompt);
    for await (const item of res.stream) {
      console.log(item.candidates[0].content.parts[0].text);
    }
    console.log("--------------------------------");
    const functionCallsData = await (await res.response).functionCalls();
    console.log(functionCallsData);
    if (functionCallsData && functionCallsData.length > 0) {
      const call = functionCallsData[0];
      if (functions[call.name]) {
        const apiResponse = await functions[call.name](call.args);
        const result22 = await chat.sendMessageStream([
          {
            functionResponse: {
              name: call.name,
              response: apiResponse,
            },
          },
        ]);
        for await (const item of result22.stream) {
          console.log(item.candidates[0].content.parts[0].text);
        }
        console.log("**********************************");
      } else {
        console.log(`Unknown function call: ${call.name}`);
      }
    }
  } catch (error) {
    console.error("Error during AI interaction:", error);
  }
}

function promptUser() {
  rl.question("Please enter your prompt: ", (prompt) => {
    functionCalling(prompt).then(() => {
      promptUser();
    });
  });
}

promptUser();
