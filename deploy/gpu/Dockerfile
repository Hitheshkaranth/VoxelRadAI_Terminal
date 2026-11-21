# One Skanda V1 model server per GPU. The PyPI torch wheel bundles its CUDA runtime; the host needs the NVIDIA
# driver and container toolkit. Weights are private: pass HF_TOKEN and MODEL_REVISION at run time, never at build.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 skanda && mkdir /models && chown skanda /models
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY serve.py .
USER skanda
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz').status==200 else 1)"
CMD ["python", "serve.py"]
