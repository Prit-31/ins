import json
import random

# load file
with open("userdata.json","r") as f:
    data = json.load(f)

# function to generate masked phone
def gen_phone():
    return "******" + str(random.randint(1000,9999))

# add phone field
for user in data:
    data[user]["phone"] = gen_phone()

# save new file
with open("users_updated.json","w") as f:
    json.dump(data,f,indent=2)

print("Done ✅")