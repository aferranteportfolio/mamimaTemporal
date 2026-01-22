import mongoose from 'mongoose';
import express from 'express';


// import { localNumberID } from './utils/globalVariabels.mjs';

// import { muletillas } from './funcionality/muletillas.mjs';

// import { mesageSorter } from './funcionality/messageSorter.mjs';

// import { remarketingSentimenAnalisis } from './funcionality/remarketingSentimenAnalisis.mjs';

// import { processMessages, processMessagestrimestral } from './funcionality/stateHandlers/stateHandlers.mjs';

// import { appendResultsToFile } from './dailyRemarketingQuerrys/dailyQuerriedInformation/fileWriter.mjs';

import { 
  getIdDocument, 
  createNewObjectInDatabase, 
  initializeObjectInDatabase,
  initializeCostumerAndStoreMessageHistory
} from './dbFunctionality/functionality.js';



const app = express();

await mongoose.connect(process.env.MONGO_URI);
console.log("✅ Connected to MongoDB");

  





let  WHATSAPP_PHONE_NUMBER_ID = "881145688403993"
let WHATSAPP_TOKEN = "EAAVcInVNCAABPo9GZCayOMJdafmPjWkK2H5a0AeLLMEJpxAwpUgoNyr4QAhwmhPHEwNZAYeiVAHYvHLZAgHpwYm9AQn9DAPPN1TtAejWEbfgk0FcgWZAMj2bVUwxjcQ3jWBMZAILDq4tr1kmRZBOVo3h9hlYNaZASdi0VCKZAJ8wpoBUQPHURRfv234ZB1eXoExKjzQEDoxrSVfwRZBRGCZBCCGmVC0lsb8vKJZCCT6NZA3Hh"









// A) Text only
//await sendMessage("51941196497", "Hola 👋🏼 ¿Cómo estás?");

// B) Image only (with caption)
//await sendMessage("51941196497", "", { url: "./test123 copy.png",   caption: "Producto nuevo 👜" });



