import baseAxios from "axios";

const axios = baseAxios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "/api",
  headers: {
    "Content-Type": "application/json",
  },
});


export default axios;
