import os                                                                                               
  from openai import OpenAI                                                                               
                                                                                                          
  client = OpenAI(api_key=os.getenv("OPENAI_API_KEY", "demo"))                                            
                                                                                                          
  response = client.chat.completions.create(                                                              
      model="gpt-4o",                                                                                     
      messages=[{"role": "user", "content": "Hello!"}]                                                    
  )                                                                                                       
                                                                                                          
  print(response.choices[0].message.content)                     